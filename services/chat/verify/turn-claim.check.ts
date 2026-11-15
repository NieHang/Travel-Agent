/**
 * Exhaustive schedule check of the trip-turn revision claim (src/trip/turn.ts, src/chat/chat.controller.ts).
 *
 * Property: once every turn has ended, conversations.tripRevision equals the revision of the latest
 * saved assistant components (0 if none). Otherwise the newest buttons render disabled for good.
 *
 * It runs the real ChatController.send + TurnService.run + FakeTripLlm. Only Prisma is replaced: an
 * in-memory store where every top-level call and every $transaction waits on a scheduler gate. The
 * checker enumerates every order of those gates for two turns on one conversation, plus up to
 * FAULTS injected faults (a DB/model call failing, or a client disconnecting), and checks the
 * property after each schedule settles.
 *
 * Run (in services/chat): bunx vitest run --config vitest.config.verify.ts. Env: FAULTS (default 1), MAX_RUNS.
 */
import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { SendTurnRequest } from '@autix/contracts';
import { ChatController } from '../src/chat/chat.controller.js';
import type { ChatService } from '../src/chat/chat.service.js';
import type { ConversationsService } from '../src/conversations/conversations.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeTripLlm } from '../src/trip/fake-llm.js';
import type { TripLlm } from '../src/trip/llm.js';
import { TurnService } from '../src/trip/turn.js';

const CONV = 'conv-1';
const FAULTS = Number(process.env.FAULTS ?? 1);
const MAX_RUNS = Number(process.env.MAX_RUNS ?? 2_000_000);

type MessageRow = {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  status: 'complete' | 'partial' | 'error';
  createdAt: Date;
  metadata: unknown;
};
type Db = { tripRevision: number; tripState: unknown; title: string; updatedAt: Date; messages: MessageRow[]; nextId: number };

type Gate = { turn: string; label: string; local: boolean; go: () => void; fail: () => void };

class Scheduler {
  pending: Gate[] = [];
  gate(turn: string, label: string, local: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({ turn, label, local, go: resolve, fail: () => reject(new Error(`injected failure: ${label}`)) });
    });
  }
}

/** Fails loudly when turn.ts starts using Prisma in a way this store does not model. */
function unsupported(what: string): never {
  throw new Error(`verify harness: unsupported Prisma usage ${what}; extend the fake in verify/turn-claim.check.ts`);
}

function only(obj: object, allowed: string[], what: string) {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) unsupported(`${what}.${key}`);
}

/** Prisma facade over `db`. `wrap` turns each call into a gated lazy op (top level) or runs it now (inside a tx). */
function tables(db: Db, wrap: <T>(label: string, run: () => T) => unknown) {
  return {
    conversation: {
      findUniqueOrThrow: (args: { where: { id: string } }) =>
        wrap('read trip state', () => {
          if (args.where.id !== CONV) unsupported('findUniqueOrThrow other id');
          return { tripState: structuredClone(db.tripState), tripRevision: db.tripRevision };
        }),
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
        wrap(describeUpdate(args), () => {
          only(args.where, ['id', 'tripRevision', 'title'], 'conversation.updateMany.where');
          only(args.data, ['tripRevision', 'tripState', 'title', 'updatedAt'], 'conversation.updateMany.data');
          const w = args.where;
          if ('tripRevision' in w && w.tripRevision !== db.tripRevision) return { count: 0 };
          if ('title' in w && w.title !== db.title) return { count: 0 };
          const d = args.data;
          if ('tripRevision' in d) {
            const v = d.tripRevision;
            if (typeof v === 'number') db.tripRevision = v;
            else if (v && typeof v === 'object' && 'increment' in v && typeof v.increment === 'number') db.tripRevision += v.increment;
            else unsupported('tripRevision update shape');
          }
          if ('tripState' in d) db.tripState = structuredClone(d.tripState);
          if (typeof d.title === 'string') db.title = d.title;
          if (d.updatedAt instanceof Date) db.updatedAt = d.updatedAt;
          return { count: 1 };
        }),
      update: (args: { where: { id: string }; data: Record<string, unknown> }) =>
        wrap('touch updatedAt', () => {
          only(args.data, ['updatedAt'], 'conversation.update.data');
          if (args.data.updatedAt instanceof Date) db.updatedAt = args.data.updatedAt;
          return {};
        }),
    },
    message: {
      create: (args: { data: Partial<MessageRow> & { conversationId: string; role: MessageRow['role']; content: string } }) =>
        wrap(`save ${args.data.role.toLowerCase()} message${args.data.status && args.data.status !== 'complete' ? ` (${args.data.status})` : ''}`, () => {
          const row: MessageRow = {
            id: `m${db.nextId++}`,
            status: 'complete',
            createdAt: new Date(),
            metadata: null,
            ...args.data,
          };
          db.messages.push(row);
          return structuredClone(row);
        }),
      findMany: (args: { where: { content?: { not: string }; id?: { not: string } } }) =>
        wrap('load history', () =>
          db.messages
            .filter((m) => m.content !== args.where.content?.not && m.id !== args.where.id?.not)
            .map((m) => ({ role: m.role, content: m.content })),
        ),
    },
  };
}

function describeUpdate(args: { where: Record<string, unknown>; data: Record<string, unknown> }): string {
  const d = args.data;
  if (d.tripRevision && typeof d.tripRevision === 'object') return `claim (rev ${String(args.where.tripRevision)} → +1)`;
  if (typeof d.tripRevision === 'number') return `release (rev ${String(args.where.tripRevision)} → ${d.tripRevision})`;
  if ('tripState' in d) return `commit state (if rev = ${String(args.where.tripRevision)})`;
  if ('title' in d) return 'set title';
  return 'update conversation';
}

type Op = { label: string; run: () => unknown; then: PromiseLike<unknown>['then'] };

function fakePrisma(db: Db, sched: Scheduler, turn: string) {
  const lazy = (label: string, run: () => unknown): Op => ({
    label,
    run,
    then: (onFulfilled, onRejected) => sched.gate(turn, label, false).then(run).then(onFulfilled, onRejected),
  });
  const direct = (_label: string, run: () => unknown) => Promise.resolve().then(run);
  const atomically = <T>(work: () => T): T => {
    const snapshot = structuredClone(db);
    try {
      return work();
    } catch (error) {
      Object.assign(db, snapshot);
      throw error;
    }
  };
  return {
    ...tables(db, lazy),
    $transaction: async (arg: Op[] | ((tx: unknown) => Promise<unknown>)) => {
      if (Array.isArray(arg)) {
        await sched.gate(turn, `tx[${arg.map((op) => op.label).join(' + ')}]`, false);
        return atomically(() => arg.map((op) => op.run()));
      }
      await sched.gate(turn, 'tx[trip turn write]', false);
      const snapshot = structuredClone(db);
      try {
        return await arg(tables(db, direct));
      } catch (error) {
        Object.assign(db, snapshot);
        throw error;
      }
    },
  };
}

/** FakeTripLlm behind gates, so a model call can fail or the client can leave mid-call. Model calls touch no shared state. */
function gatedLlm(sched: Scheduler, turn: string): TripLlm {
  const inner = new FakeTripLlm();
  const step = async (label: string, signal?: AbortSignal) => {
    await sched.gate(turn, label, true);
    signal?.throwIfAborted();
  };
  return {
    locate: async (d, signal) => (await step('model: locate', signal), inner.locate(d, signal)),
    classify: async (input, signal) => (await step('model: classify', signal), inner.classify(input, signal)),
    extractStops: async (day, locale, signal) => (await step('model: extract stops', signal), inner.extractStops(day, locale, signal)),
    respond: async function* (task, input, signal) {
      await step('model: respond', signal);
      yield* inner.respond(task, input, signal);
    },
  };
}

function fakeResponse() {
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    closed: false,
    headersSent: false,
    status: () => res,
    setHeader: () => res,
    flushHeaders: () => {
      res.headersSent = true;
    },
    write: () => true,
    end: () => undefined,
  });
  return res;
}

type Turn = { name: string; res: ReturnType<typeof fakeResponse>; outcome: string | null; disconnected: boolean };

type Action = { label: string; fault: boolean; run: () => void };

type Run = { trace: string[]; widths: number[]; violation: string | null; db: Db };

async function runOnce(choices: number[]): Promise<Run> {
  const db: Db = { tripRevision: 0, tripState: {}, title: '', updatedAt: new Date(0), messages: [], nextId: 1 };
  const sched = new Scheduler();
  const turns: Turn[] = [];
  const trace: string[] = [];
  const widths: number[] = [];
  let faults = FAULTS;

  const start = (name: string, revision: number) => {
    const res = fakeResponse();
    const turn: Turn = { name, res, outcome: null, disconnected: false };
    turns.push(turn);
    const controller = new ChatController(
      {} as ChatService,
      { assertOwned: async () => undefined } as unknown as ConversationsService,
      new TurnService(fakePrisma(db, sched, name) as unknown as PrismaService, gatedLlm(sched, name)),
    );
    const request: SendTurnRequest = { revision, command: { type: 'message', text: '杭州' }, locale: 'zh' };
    controller
      .send({ userId: 'u1' } as never, CONV, request, res as unknown as Response)
      .then(
        () => (turn.outcome = 'returned'),
        (e: unknown) => (turn.outcome = `threw ${e instanceof Error ? e.message : String(e)}`),
      );
  };

  start('A', 0);
  for (let step = 0; ; step++) {
    await settle();
    const actions = enabled();
    if (actions.length === 0) break;
    const pick = choices[step] ?? 0;
    widths.push(actions.length);
    const action = actions[pick];
    if (action.fault) faults--;
    trace.push(action.label);
    action.run();
  }
  await settle();

  const stuck = turns.filter((t) => t.outcome === null);
  if (stuck.length) throw new Error(`verify harness: turn(s) ${stuck.map((t) => t.name).join(',')} never finished; a gate was dropped`);
  const committed = Math.max(0, ...db.messages.map((m) => readRevision(m.metadata)));
  const violation =
    db.tripRevision === committed
      ? null
      : `all turns ended, but tripRevision = ${db.tripRevision} while the latest saved components have revision ${committed}`;
  return { trace, widths, violation, db };

  function enabled(): Action[] {
    const actions: Action[] = [];
    // Model calls commute with everything the other turn does, so run them first (still offering faults).
    const local = sched.pending.find((g) => g.local);
    const gates = local ? [local] : sched.pending;
    for (const g of gates) {
      const take = () => sched.pending.splice(sched.pending.indexOf(g), 1);
      actions.push({ label: `${g.turn}: ${g.label}`, fault: false, run: () => (take(), g.go()) });
      if (faults > 0) actions.push({ label: `${g.turn}: ${g.label} FAILS`, fault: true, run: () => (take(), g.fail()) });
    }
    if (faults > 0)
      for (const t of turns)
        if (t.outcome === null && !t.disconnected)
          actions.push({
            label: `${t.name}: client disconnects`,
            fault: true,
            run: () => {
              t.disconnected = true;
              t.res.closed = true;
              t.res.destroyed = true;
              t.res.emit('close');
            },
          });
    // Turn B is a second tab: it sends with whatever revision GET /ui-state reports right now.
    if (!local && turns.length === 1)
      actions.push({ label: `B: tab reads ui-state (rev ${db.tripRevision}) and sends`, fault: false, run: () => start('B', db.tripRevision) });
    return actions;
  }
}

function readRevision(metadata: unknown): number {
  if (metadata && typeof metadata === 'object' && 'revision' in metadata && typeof metadata.revision === 'number') return metadata.revision;
  return 0;
}

async function settle() {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
}

/** Next schedule in depth-first order, or null when every schedule has run. */
function nextChoices(taken: number[], widths: number[]): number[] | null {
  for (let i = taken.length - 1; i >= 0; i--) if (taken[i] + 1 < widths[i]) return [...taken.slice(0, i), taken[i] + 1];
  return null;
}

describe('trip turn revision claim', () => {
  it(`every schedule of two turns with up to ${FAULTS} fault(s) leaves the revision released or committed`, async () => {
    let choices: number[] | null = [];
    let runs = 0;
    let violations = 0;
    // Shortest violating schedule per fault kind ("no fault" = a pure race), so distinct causes show separately.
    const shortest = new Map<string, Run>();
    while (choices && runs < MAX_RUNS) {
      const run = await runOnce(choices);
      runs++;
      if (run.violation) {
        violations++;
        const fault = run.trace.find((s) => s.endsWith(' FAILS') || s.endsWith('client disconnects'));
        const kind = fault ? fault.replace(/^[AB]: /, '') : 'no fault';
        const best = shortest.get(kind);
        if (!best || run.trace.length < best.trace.length) shortest.set(kind, run);
      }
      const taken = run.widths.map((_, i) => choices![i] ?? 0);
      choices = nextChoices(taken, run.widths);
    }
    const exhaustive = choices === null;
    console.log(`schedules explored: ${runs}${exhaustive ? ' (exhaustive)' : ` (stopped at MAX_RUNS=${MAX_RUNS})`}, violations: ${violations}`);
    for (const [kind, run] of shortest) {
      console.log(`\nCounterexample [${kind}] (${run.trace.length} steps):`);
      run.trace.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s}`));
      console.log(`  => ${run.violation}`);
      console.log(`  messages: ${run.db.messages.map((m) => `${m.role}${m.status !== 'complete' ? `(${m.status})` : ''}${readRevision(m.metadata) ? `@rev${readRevision(m.metadata)}` : ''}`).join(', ') || '(none)'}`);
    }
    expect(exhaustive).toBe(true);
    expect([...shortest.keys()]).toEqual([]);
  }, 600_000);
});

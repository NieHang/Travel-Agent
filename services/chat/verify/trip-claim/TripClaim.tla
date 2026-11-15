---------------------------- MODULE TripClaim ----------------------------
(***************************************************************************)
(* The trip turn revision claim in services/chat/src/trip/turn.ts.          *)
(*                                                                          *)
(* One conversation row (tripRevision column, tripState) and assistant      *)
(* messages, shared by several turns running at once (tabs). Each action    *)
(* below is one Prisma call or one $transaction in turn.ts, so it is atomic *)
(* in the code too.                                                         *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Turns, None

VARIABLES
  rev,    \* conversation.tripRevision
  st,     \* conversation.tripState, as the id of the commit that wrote it
  log,    \* every tripState write in order: [id, parent]
  msgs,   \* assistant messages: [rev: metadata.revision or None, comps: state they render]
  pc,     \* each turn's place in TurnService.run()
  seen,   \* revision the turn loaded (request.revision once it passes the 409 check)
  base,   \* tripState the turn loaded; reduce() and render() work from it
  lost    \* a cleanup transaction failed, so some claim has no assistant message

vars == <<rev, st, log, msgs, pc, seen, base, lost>>

Origin == <<None, 0>>   \* the tripState before any turn (null in a new conversation)

Init ==
  /\ rev = 0
  /\ st = Origin
  /\ log = << [id |-> Origin, parent |-> None] >>
  /\ msgs = {}
  /\ pc = [t \in Turns |-> "idle"]
  /\ seen = [t \in Turns |-> 0]
  /\ base = [t \in Turns |-> Origin]
  /\ lost = FALSE

\* run(): this.load() reads tripState and tripRevision in one findUniqueOrThrow.
\* A client can only send the revision it last read, so a request that passes the
\* 409 check is one whose revision equals rev here; a stale one changes nothing.
Load(t) ==
  /\ pc[t] = "idle"
  /\ pc' = [pc EXCEPT ![t] = "loaded"]
  /\ seen' = [seen EXCEPT ![t] = rev]
  /\ base' = [base EXCEPT ![t] = st]
  /\ UNCHANGED <<rev, st, log, msgs, lost>>

\* saveUserMessage(): updateMany where tripRevision = request.revision, increment by 1,
\* then re-reads tripState under that row lock and rolls back if it is not the loaded one.
Claim(t) ==
  /\ pc[t] = "loaded"
  /\ rev = seen[t]
  /\ st = base[t]
  /\ rev' = rev + 1
  /\ pc' = [pc EXCEPT ![t] = "working"]
  /\ UNCHANGED <<st, log, msgs, seen, base, lost>>

\* saveUserMessage() finds count 0 or a changed tripState (409), or its transaction fails
\* and rolls back.
ClaimFails(t) ==
  /\ pc[t] = "loaded"
  /\ pc' = [pc EXCEPT ![t] = "done"]
  /\ UNCHANGED <<rev, st, log, msgs, seen, base, lost>>

Claimed(t) == seen[t] + 1   \* next.revision from reduce()

\* saveTurn(): updateMany where tripRevision = next.revision writes tripState,
\* then creates the assistant message with metadata.revision = next.revision.
Commit(t) ==
  /\ pc[t] = "working"
  /\ rev = Claimed(t)
  /\ LET new == <<t, Claimed(t)>> IN
       /\ st' = new
       /\ log' = Append(log, [id |-> new, parent |-> base[t]])
       /\ msgs' = msgs \cup {[rev |-> Claimed(t), comps |-> new]}
  /\ pc' = [pc EXCEPT ![t] = "done"]
  /\ UNCHANGED <<rev, seen, base, lost>>

\* saveTurn() conflicts (count 0), the model or a save fails, or the client stops:
\* every path after the claim goes through the finally block.
Fails(t) ==
  /\ pc[t] = "working"
  /\ pc' = [pc EXCEPT ![t] = "settling"]
  /\ UNCHANGED <<rev, st, log, msgs, seen, base, lost>>

\* saveAssistant(): the row still at state.revision + 1 means this turn owns the
\* newest revision, so the message carries render(state) at that revision.
Settle(t) ==
  /\ pc[t] = "settling"
  /\ msgs' = msgs \cup {[rev |-> IF rev = Claimed(t) THEN Claimed(t) ELSE None,
                         comps |-> base[t]]}
  /\ pc' = [pc EXCEPT ![t] = "done"]
  /\ UNCHANGED <<rev, st, log, seen, base, lost>>

\* The cleanup transaction itself fails; it is not retried.
SettleFails(t) ==
  /\ pc[t] = "settling"
  /\ pc' = [pc EXCEPT ![t] = "done"]
  /\ lost' = TRUE
  /\ UNCHANGED <<rev, st, log, msgs, seen, base>>

Finished == /\ \A t \in Turns : pc[t] = "done"
            /\ UNCHANGED vars

Next ==
  \/ \E t \in Turns : Load(t)
  \/ \E t \in Turns : Claim(t)
  \/ \E t \in Turns : ClaimFails(t)
  \/ \E t \in Turns : Commit(t)
  \/ \E t \in Turns : Fails(t)
  \/ \E t \in Turns : Settle(t)
  \/ \E t \in Turns : SettleFails(t)
  \/ Finished

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Rules *)

\* Buttons the client treats as live (MessageList: metadata.revision equals the
\* revision from ui-state) are rendered from the trip state that is saved now.
LiveComponentsMatchState ==
  \A m \in msgs : m.rev = rev => m.comps = st

\* Every tripState write builds on the state it replaces: no turn's saved
\* plan is overwritten by a turn that never saw it.
NoLostUpdate ==
  \A i \in 2..Len(log) : log[i].parent = log[i - 1].id

\* At most one live message per revision, so the client never shows two sets of
\* live buttons.
OneLiveMessagePerRevision ==
  \A m1, m2 \in msgs : (m1.rev = m2.rev /\ m1.rev # None) => m1 = m2

\* Once every turn has ended, the newest revision has live buttons again (the claim
\* was released), unless a cleanup write failed. Revision 0 needs none: the
\* conversation has not started.
ClaimReleased ==
  (\A t \in Turns : pc[t] = "done") /\ ~lost =>
    rev = 0 \/ \E m \in msgs : m.rev = rev

TypeOK ==
  /\ rev \in Nat
  /\ pc \in [Turns -> {"idle", "loaded", "working", "settling", "done"}]
=============================================================================

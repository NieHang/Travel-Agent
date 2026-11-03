import { HumanMessage } from '@langchain/core/messages';
import { FakeTripLlm } from '../src/trip/fake-llm.js';
import { initialState } from '../src/trip/state.js';
import { turn } from './turn.js';

it('passes history through classify and respond and records tool evidence', async () => {
  const llm = new FakeTripLlm();
  const classify = vi.spyOn(llm, 'classify');
  const respond = vi.spyOn(llm, 'respond');
  const history = [new HumanMessage('Earlier constraints')];
  const result = await turn(llm, initialState(0, 'en'), 'Hello', { history });
  expect(result.effect).toBe('answer');
  expect(result.draft.length).toBeGreaterThan(0);
  expect(classify.mock.calls[0][0].history).toBe(history);
  expect(respond.mock.calls[0][1].history).toBe(history);
  expect(result.toolResults).toEqual([]);
  expect(result.toolCalls).toEqual([]);
});

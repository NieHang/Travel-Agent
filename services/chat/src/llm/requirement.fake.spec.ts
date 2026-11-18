import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { LlmModule } from './llm.module.js';
import { FakeRequirementService } from './requirement.fake.js';
import { RequirementService } from './requirement.service.js';

describe('FakeRequirementService', () => {
  it('returns the demo fixture', async () => {
    expect(await new FakeRequirementService().extract('x')).toEqual({
      requirements: [{ action: '规划行程', constraints: ['测试数据'], entities: ['行程'] }],
    });
  });
});

describe('LlmModule bindings', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['1', FakeRequirementService],
    ['true', FakeRequirementService],
    [undefined, RequirementService],
  ])('LLM_FAKE=%s 时 LlmModule 绑定对应实现', async (flag, reqCls) => {
    vi.stubEnv('LLM_FAKE', flag);
    const mod = await Test.createTestingModule({
      imports: [LlmModule],
    }).compile();
    expect(mod.get(RequirementService)).toBeInstanceOf(reqCls);
  });
});

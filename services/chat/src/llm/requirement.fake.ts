import { Injectable } from '@nestjs/common';
import type { RequirementResult } from '@autix/contracts';

const FAKE_REQUIREMENTS: RequirementResult = {
  requirements: [
    { action: '规划行程', constraints: ['测试数据'], entities: ['行程'] },
  ],
};

@Injectable()
export class FakeRequirementService {
  async extract(_input: string, _signal?: AbortSignal): Promise<RequirementResult> {
    return FAKE_REQUIREMENTS;
  }
}

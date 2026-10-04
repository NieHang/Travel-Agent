import { Module } from '@nestjs/common';
import { UIChatController } from './ui-chat.controller.js';
import { UIFlowService } from './ui-flow.service.js';
import { UIResponseService } from './ui-response.service.js';
import { UIStreamService } from './ui-stream.service.js';
import { FakeUIResponseService } from './ui-response.fake.js';
import { isLlmFakeEnabled } from '../../config/auth.config.js';

@Module({
  controllers: [UIChatController],
  providers: [
    {
      provide: UIResponseService,
      useFactory: () =>
        isLlmFakeEnabled()
          ? new FakeUIResponseService()
          : new UIResponseService(),
    },
    UIFlowService,
    UIStreamService,
  ],
  exports: [UIResponseService, UIFlowService, UIStreamService],
})
export class UIProtocolModule {}

import { Module } from '@nestjs/common';
import { UIChatController } from './ui-chat.controller.js';
import { UIFlowService } from './ui-flow.service.js';
import { UIResponseService } from './ui-response.service.js';
import { UIStreamService } from './ui-stream.service.js';
import { FakeUIResponseService } from './ui-response.fake.js';
import { isLlmFakeEnabled } from '../../config/auth.config.js';
import { McpModule } from '../mcp/mcp.module.js';
import { McpService } from '../mcp/mcp.service.js';

@Module({
  imports: [McpModule],
  controllers: [UIChatController],
  providers: [
    {
      provide: UIResponseService,
      inject: [McpService],
      useFactory: (mcp: McpService) =>
        isLlmFakeEnabled()
          ? new FakeUIResponseService()
          : new UIResponseService(mcp),
    },
    UIFlowService,
    UIStreamService,
  ],
  exports: [UIResponseService, UIFlowService, UIStreamService],
})
export class UIProtocolModule {}

import { Global, Module } from '@nestjs/common';
import { AUTH_CONFIG, loadAuthConfig } from './auth.config.js';

/** 配置在容器创建时加载：环境变量有误会让启动直接失败。 */
@Global()
@Module({
  providers: [{ provide: AUTH_CONFIG, useFactory: () => loadAuthConfig() }],
  exports: [AUTH_CONFIG],
})
export class ConfigModule {}

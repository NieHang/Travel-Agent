import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/decorators.js';

@Controller()
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Public()
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('hello')
  getHello() {
    return this.appService.getHello();
  }
}

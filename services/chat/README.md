<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## LangChain 工具调用

两个接口均用于需求抽取，接收相同的请求体：

```json
{ "input": "用户注册时必须绑定手机号，密码至少8位" }
```

- `POST /api/langchain/tool-bind`：绑定工具后调用一次模型，返回
  `{ "content": "...", "tool_calls": [...] }`，其中 `tool_calls` 是模型提出的调用。
- `POST /api/langchain/tool-loop`：执行模型提出的工具调用，通过 `ToolMessage`
  回填结果，直到模型返回最终内容，响应为 `{ "content": "..." }`。
  最多执行 5 轮工具调用，并允许随后的一次模型调用返回最终结果；仍需调用工具时返回 HTTP 502。

省略 `input` 时使用上述示例；非字符串输入返回 HTTP 400。
两个接口复用现有模型配置和需求抽取提示词，需要配置
`OPENAI_API_KEY`、`OPENAI_BASE_URL`，模型和提供方须支持工具调用。

工具定义位于 `src/llm/tools/basic.tools.ts`：

- `check_constraint_validity`：参数为 `{ constraint, input }`。
  检查约束是否出现在原文中，且包含“必须 / 至少 / 不得 / 不能”标记。
  循环执行时使用 HTTP 请求中的原始需求作为 `input`，不采信模型生成的原文。
  这是文本规则检查，不判断业务可行性或约束冲突。
- `lookup_entity_definition`：参数为 `{ entity }`。
  查询“用户 / 手机号 / 密码”的内置通用定义；未知实体返回
  `{ entity, found: false, definition: null }`。

工具名称或参数错误会以工具结果回填，供模型修正；无法解析的模型调用返回 HTTP 502。

## 文件与业务查询助手

`POST /api/files/chat` 接收 `{ "input": "..." }`，返回 `{ "content": "..." }`。
复用上述模型配置，按需调用三个 `tool()` + Zod 工具：

- `query_requirement({ requirementId })`：读取 `requirements/{requirementId}.json`。
- `read_file({ path })`：读取 UTF-8 文件，例如 `standards/requirement-spec.md`。
- `write_file({ path, content })`：写入完整 UTF-8 内容，自动创建父目录，覆盖已有文件。

工作目录固定为 **`services/chat/workspace/`**，与启动命令所在目录无关，源码和
编译后的服务共用此目录。部署时需保留该目录，并赋予服务读写权限。
工具路径均相对于此目录，**不带 `workspace/` 前缀**。`safePath` 拒绝绝对路径、
`..`、Windows 盘符和特殊路径、符号链接、junction 及文件硬链接。
此校验用于工具路径隔离；workspace 应由服务独占写入，不支持其他进程在操作期间替换目录或链接。

仓库附带明确标注的测试需求 `REQ-2026-001.json` 和规范
`standards/requirement-spec.md`，可替换为实际业务内容。调用示例：

```sh
curl -X POST http://localhost:4001/api/files/chat -H "Content-Type: application/json" -d '{"input":"查询需求单 REQ-2026-001 的详情"}'
curl -X POST http://localhost:4001/api/files/chat -H "Content-Type: application/json" -d '{"input":"读取 standards/requirement-spec.md 并判断需求单 REQ-2026-001"}'
curl -X POST http://localhost:4001/api/files/chat -H "Content-Type: application/json" -d '{"input":"把需求判断结论写入 reports/REQ-2026-001-analysis.md"}'
```

每次请求独立执行，不保留跨请求对话；写报告时会重新读取需求依据。服务先记录模型
工具调用，再顺序执行全部调用，以带相同 `tool_call_id` 的 `ToolMessage` 回填结果，
继续调用模型，直到获得最终回答。工具错误回填供模型修正；最多执行 5 轮工具，
随后允许一次最终模型回答。无法解析、缺失 ID 或超出上限的调用返回 HTTP 502；
缺失、空白或非字符串 `input` 返回 HTTP 400。

## Project setup

```bash
$ bun install
```

## Compile and run the project

```bash
# development
$ bun run start

# watch mode
$ bun run start:dev

# production mode
$ bun run start:prod
```

## Run tests

```bash
# unit tests
$ bun run test

# e2e tests
$ bun run test:e2e

# test coverage
$ bun run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ bun install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

This project is already instrumented. Create a free account at [observe.nestjs.com](https://observe.nestjs.com), add an application, and paste the generated app key and secret into the `ObserveModule.forRoot()` call in `src/app.module.ts`.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

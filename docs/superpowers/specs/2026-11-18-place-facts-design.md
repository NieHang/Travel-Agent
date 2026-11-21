# 地点事实库与按日期核对 设计

日期：2026-11-18
状态：按日期核对已于 2026-11-21 移除（`checkPlan`、`stop.check`、`placeChecks`、评测里的三个 place 指标和前端标记）。原因：产品方向改为让模型在编排时通过工具搜索知识库，核对需要另外维护一份事实，与知识库重复。保留的只有 `records/`、`placeFacts` 和 `places:lint` / `places:pin`。下文关于核对的部分仅作历史记录。

此前的状态：第一版已实现（2026-11-19，分支 `feat/place-facts`）。下文是实现前的草图，示例记录里的数值来自当时的审计和记忆，以 `services/chat/src/places/records/` 为准（例如兴福寺五重塔的修缮按奈良县的说明到 2034-03，不是下文的 2031-03）。

与草图的差异：

- 首批 12 个地点，事实逐条取自官方页面；place ID 已用 `places:pin` 绑定。
- 冲突只标注，没有实现自动重排。匹配不到的站点默认不显示标记（`PLACE_POLICY.unmatched`）。
- 轨道类型只有地铁、JR、私铁三种。
- 营业时间不能按星期区分，所以两家国立博物馆（周五、周六延长）没有录营业时间；只有部分区域有营业时间的浅草寺、兴福寺也没有录。
- 离开时间依次取：站点自己写的时段、备注里写明的停留时长、预计停留时间（下一站更早开始时取下一站的时间）。
- 假日表来自内阁府的公布数据，覆盖 2026–2027 年；超出范围时“逢假日顺延”的规则按普通星期判断。

## 问题

行程草稿里几乎没有具体事实（提示词禁止），靠“请自行核实”回避，同时仍有模型自己发现不了的日期类错误。2026-11-18 的审计（10 份真实草稿、104 个站点）查到：

- 东本愿寺排在 12 月的 16:00、停留约 1 小时（11–2 月 16:30 关门）。
- 兴福寺五重塔被当作看点（修缮罩棚到 2031-03，出自城市 skill）。
- 筑地场外市场、锦市场排在周三。
- 伏见稻荷、东福寺写成“乘地铁”，关西机场写成“乘地铁”。

11-14 的基线显示地点本身不存在或停业的比例为 0/38，所以要解决的不是“地点是否真实”，而是“这个地点在这一天、这个时间、用这种方式是否可行”。这一步不能交给模型，必须由服务端比对。

现有系统对设计的约束：

- `StopSchema` 同时是模型抽取站点的结构化输出格式，往里加字段就等于让模型来填。
- `readState` 遇到任何解析失败都会重置行程；认领 revision 时会深度比较两次读取的结果。
- 每天没有存日期（第 i 天是 `departureDate + i`），`stop.time` 是自由文本，站点名是模型按界面语言写的。
- 每轮最多 5 个工具轮次，已经被加载 skill、搜酒店、展示结果占用。
- `TripViewSchema` 顶层是 `.strict()`，嵌套的 stop 对象不是。
- 本机没有 Google 密钥；同一查询返回的 place ID 会变，只允许长期保存 ID 本身。
- 构建产物只包含 `src` 编译结果，`skills/` 目录目前也没有进镜像。

## 用法（调用方视角）

**维护者新增或复核一条记录。** 记录是 TypeScript 数据，每个城市一个文件。代理读官方页面后写入记录并附上原文引句，人在 git 里评审差异：

```ts
// services/chat/src/places/records/kyoto.ts
{
  slug: 'higashi-hongan-ji',
  city: 'kyoto',
  pin: { status: 'unpinned', query: '東本願寺 京都市下京区' },
  name: { en: 'Higashi Hongan-ji', zh: '东本愿寺', ja: '東本願寺' },
  aliases: ['Higashi Honganji', '真宗本庙'],
  visitMinutes: 45,
  hours: {
    type: 'schedule',
    periods: [
      { from: '03-01', to: '10-31', open: '05:50', close: '17:30' },
      { from: '11-01', to: '02-28', open: '06:20', close: '16:30' },
    ],
    source: 'https://www.higashihonganji.or.jp/worship/',
    quote: '3月～10月 5:50～17:30／11月～2月 6:20～16:30',
    checkedOn: '2026-11-18',
  },
  closures: [],
  access: { rail: ['jr', 'subway', 'private_rail'], source: '…', quote: '…', checkedOn: '2026-11-18' },
}
```

```sh
bun run test            # records.spec.ts：格式、全年覆盖、别名冲突，不合格即失败
bun run places:lint     # 过期事实、已结束的施工、未绑定 place ID 的记录
bun run places:pin      # 有 GOOGLE_MAPS_API_KEY 后由人运行：为未绑定的记录提议 place ID
```

**视图**（`state.ts` 的 `toTripView`，签名不变）：

```ts
const check = checkPlan(s)                    // 与 s.days[i].stops[j] 一一对应
stops: d.stops.map((stop, j) => ({ ...stop, check: stopCheckView(check.days[i][j], c) }))
// -> { name: '东本愿寺', time: '16:00', note: null,
//      check: { level: 'conflict', notes: [{ text: '11–2 月 16:30 关门，这一站会超过关门时间',
//               url: 'https://www.higashihonganji.or.jp/worship/', checkedOn: '2026-11-18' }] } }
```

面板在每个站点后显示一个 HeroUI Chip，悬停或点按显示说明、来源链接和核实日期。

**模型**（`llm.ts` 的 `context()`，不新增工具，不占轮次）：

```jsonc
"serverContext": {
  // 写草稿之前：目的地城市的事实，已按出行日期换算
  "placeFacts": ["Higashi Hongan-ji (东本愿寺): open 06:20–16:30 on your dates",
                 "Fushimi Inari Taisha: JR Nara Line or Keihan; no subway",
                 "Kofuku-ji: five-storey pagoda under scaffolding until 2031-03-31"],
  // 已有草稿时：当前的冲突，带 [D#] 天数标记
  "placeChecks": ["[D2] 东本愿寺 (16:00): closes 16:30; the visit runs past closing"]
}
```

**`runEffect`**：默认策略下不调用任何新东西。策略为“重排”时，对有冲突的天复用现有的 revise 流程跑一次。

**评分器**：

```ts
scores.push(...gradePlaces(item, out))   // place_conflict_rate, place_caution_rate, place_unverified_share
```

## 形状

### 核对结果是推导出来的，不存进行程状态

这是整个设计的支点。`checkPlan(state)` 是纯函数，输入只有已经存着的站点、出发日期，以及编译进构建的事实库。四个读取方都调用它：`toTripView`、`context()`、`runEffect`（仅策略为重排时）、评分器。

- `TripStateV3Schema` 和 `StopSchema` 都不改：没有迁移，`readState` 不会因此重置行程，认领时的深度比较不受影响。
- `splice` 之后不需要“哪些天要重新核对”的规则。
- 事实库在 git 里修正后，已有行程下次读取就更正。
- 用户、模型、评分器看到的结论不可能不一致，因为谁都不持有副本。

这偏离了“把结果附在行程状态上”的原始说法，是有意的。前提是“站点名 → 记录”的匹配是确定性的；如果以后匹配需要模型参与，就必须把匹配结果存到站点上（见“备选方案”第二条）。

### 模块

```
services/chat/src/places/
  record.ts      记录格式（Zod）、全年覆盖和别名冲突等跨字段校验
  records/       kyoto.ts tokyo.ts osaka.ts nara.ts holidays.ts（数据）
  check.ts       匹配、时间解析、比对规则；纯函数
  index.ts       唯一对外入口：checkPlan、placeFacts、conflictDays、PLACE_POLICY、结果类型
  lint.ts        过期、已结束施工、未绑定 ID
```

oxlint 禁止从 `src/places` 之外导入 `index.ts` 以外的文件，`check.ts` 和 `index.ts` 加入“纯文件”名单。

### 数据结构

```ts
type PlaceRecord = {
  slug: string                        // 库内主键，录入时就有
  city: 'tokyo' | 'kyoto' | 'osaka' | 'nara'
  pin:                                // Google place ID 的状态
    | { status: 'pinned'; placeId: string; pinnedOn: IsoDate }
    | { status: 'unpinned'; query: string }
  name: { en: string; zh: string; ja: string }
  aliases: string[]                   // 模型可能写出的其他叫法
  visitMinutes: number                // 推算离开时间用
  hours:
    | { type: 'always_open' } & Sourced
    | { type: 'schedule'; periods: HoursPeriod[] } & Sourced   // 必须覆盖全年
    | { type: 'not_recorded' }                                  // “不知道”与“全天开放”不能混淆
  closures: Closure[]
  access: ({ rail: RailKind[] } & Sourced) | null               // 穷举：没列出的轨道类型即“到不了”
}

type Sourced = { source: HttpsUrl; quote: string /* 原文引句 ≤300 字 */; checkedOn: IsoDate }

type Closure = Sourced & {
  when:
    | { type: 'weekly'; days: Weekday[]; holidayShift: boolean }  // “周一休，逢假日顺延”
    | { type: 'holidays' }
    | { type: 'dates'; dates: IsoDate[] }                          // 筑地的休市日：不是每个周三
    | { type: 'range'; from: IsoDate; until: IsoDate }             // 施工，必须有结束日期
  scope:
    | { type: 'whole' }
    | { type: 'most_shops' }                                       // 市场、商店街：提醒而非冲突
    | { type: 'part'; name: LocalName; aliases: string[] }         // 兴福寺五重塔
}

type StopCheck =
  | { status: 'unmatched'; reason: 'no_match' | 'ambiguous' }
  | { status: 'matched'; record: PlaceRecord; date: IsoDate | null; findings: Finding[] }

type Finding = { severity: 'conflict' | 'caution' } & Sourced & (
  | { kind: 'closed_day'; scope: Closure['scope'] }
  | { kind: 'before_opening'; opens: Clock }
  | { kind: 'past_closing'; closes: Clock; endsBy: 'stated' | 'next_stop' | 'visit_minutes' }
  | { kind: 'works'; until: IsoDate; part: LocalName | null }
  | { kind: 'wrong_rail'; stated: RailKind; served: RailKind[] }
)

type PlanCheck = { days: StopCheck[][]; counts: { stops; matched; conflict; caution; unmatched } }
```

```ts
// index.ts
export function checkPlan(state: Pick<TripState, 'days' | 'requirements'>): PlanCheck
export function placeFacts(requirements: Requirements, locale: 'en'): string[]   // 给模型：目的地城市、已按日期换算
export function conflictDays(check: PlanCheck): number[]                          // 0-based，给 EditTarget
export const PLACE_POLICY: PlacePolicy
```

### 规则

- **匹配**：名称做 NFKC、小写、去掉非字母数字后，先精确匹配别名，再取被包含的最长别名；两条记录打平即 `ambiguous`，按未核实处理，不猜。不用模型。
- **日期**：`departureDate + 天序号`，用 UTC 取星期。没有出发日期时只做与日期无关的检查（到达方式）。
- **时间**：`"14:00"`、`"约 08:00"`、`"approx. 16:30"` 解析为时刻；`"上午"`、`"Morning"` 解析为时段，只可能产生提醒；解析不了就跳过开放时间检查，其余照做。永不抛错。离开时间依次取：站点自己写的范围、下一站的开始时间、`visitMinutes`。
- **到达方式**：只检查站点备注里明确写出的轨道类型（地铁、JR、私铁等）。“乘电车”“步行”“出租车”不判错。
- **严重程度**：整处关闭、超过关门时间、轨道类型到不了为冲突；多数店铺休息、局部施工且站点没提到该部分为提醒。

### 策略（产品决定，全部集中在一个对象里）

```ts
type PlacePolicy = {
  onConflict: { type: 'annotate' } | { type: 'rewrite_once'; maxDays: number }
  unmatched: 'show' | 'hide' | 'show_in_covered_cities'
  staleAfterDays: number          // 只影响 lint，不改变运行时结论
}
```

覆盖范围不是开关，而是 `records/` 里有哪些城市文件。Google 实时字段只留一个接缝：`pin.placeId`，以及将来给 `checkPlan` 增加一个可选的实时数据参数。

### 接口深度

`src/places` 之外只看得到 `checkPlan`、`placeFacts`、`conflictDays`、策略和结果类型。藏在后面的有：记录格式和跨字段校验、名称归一化和打平规则、中英文时间解析、季节跨年和假日顺延、施工日期、轨道类型词表。调用方不需要了解其中任何一条。

### 明确不做

- 运行时不联网、不调 Google。
- 匹配和比对不使用模型。
- 不新增工具、SSE 事件或组件类型。
- 不核对正文里的自由陈述（“08:00 开门前后”）。给模型的 `placeFacts` 用来预防这类错误，核对逻辑不负责发现它们。
- 不核对步行距离和交通耗时。

## 综合决定

两个候选（Opus 与当前模型各一份）独立得出了同一个形状：核对结果推导而不存储、以 slug 为工作主键而 place ID 作为记录内字段、确定性别名匹配、通过 `serverContext` 给模型、TripView 的嵌套 `stop.check`、单一策略对象、同一函数供评分器使用。按 arena 的规则，这种收敛直接采用共识形状。裁判环节跳过：配置里的两个候选都是 Claude 系，没有其他家族的模型可用。

唯一的实质分歧是数据格式：

- **采用候选 2 的 TypeScript 数据**（`src/places/records/*.ts`）：随 `dist` 发布，不依赖镜像复制数据目录（`skills/` 现在就漏了），`satisfies` 给出编辑期类型错误，不需要加载器。
- **没采用候选 1 的“每个地点一个 YAML + 官方页面快照”**：需要文件加载和镜像改动；仓库是公开的，把官方页面全文存进去有版权顾虑。改用候选 2 的“来源链接 + 不超过 300 字的原文引句”。

从候选 1 并入的部分：

- 闭馆模型 `when × scope`，尤其是按具体日期列出的休市日。候选 2 的“每周三多数店休息”对筑地不准确。
- `hours` 用 `always_open | schedule | not_recorded` 三态，替代“00:00–24:00”的写法。
- 假日表（`records/holidays.ts`，带覆盖范围，超出范围的假日规则不判断）。
- `visitMinutes` 和 `endsBy`，让说明文字能讲清离开时间是怎么推出来的。
- `placeFacts`（写之前）与 `placeChecks`（写之后，带 `[D#]`）分开。
- `copy.ts` 里对 `Finding['kind']` 的穷举 switch，新增类型没有文案就编译不过。
- 评分放在 `gradeItinerary` 之后展开，避免比率型指标被 `code_checks_pass` 当成通过/失败。
- 模块压到 4 个文件，而不是候选 2 的 9 个。

## 接受的取舍

- 每次生成视图、上下文都重新计算（纯函数，最多 60 天 × 20 站的查表），换来没有存储副本、没有迁移、没有过期结论。
- 事实库更新后，旧行程的标记会变；已保存的助手消息文字可能与之后的面板不一致。消息是历史记录，可以接受。
- 记录是 TypeScript，非工程人员不便编辑，脚本只改 `pin` 一行，换来随构建发布和类型检查。
- 以 slug 为工作主键、place ID 为记录内字段，换来今天没有密钥也能用。
- 宁可“未核实”也不错配：别名没覆盖到的叫法显示为未核实，`place_unverified_share` 衡量这个代价。
- 只检查轨道类型；“乘公交”到一个没有合适公交的地方查不出来。
- 这是提示词改动（`SKILL_FACTS_RULE` 允许陈述 `placeFacts` 里的事实，`serverContext` 增加内容），评测的提示词哈希会变，需要新基线和真实模型运行。
- 过期不改变运行时结论；标记上显示核实日期，由 lint 提醒维护者。

## 备选方案

- **把核对结果存进行程状态**（`runEffect` 抽取站点后写入）。符合最初的说法，评分器读现成数据。落选原因：给一个“解析失败即重置”的结构加存储字段，每个改动天数或日期的地方都要重算，结论冻结在写入时。调用方还得知道存的值是否仍然有效。
- **只在站点上存记录引用，结论仍然推导**（即酒店的 `stayRef` 模式）。是真正的竞争者，匹配一旦需要模型就该换成它。现在落选是因为它需要在抽取格式之外再建一个站点结构、迁移已有行程、在 `runEffect` 里加两处写入，而存的东西查一次表就能得到。
- **让模型调用 `check_places` 工具，或把事实追加到 `load_skill` 的输出里。** 占用工具轮次（明确的反目标），把是否使用比对结果留给模型，面板拿不到任何东西。后者还把已核实的事实混进提示词称为“未核实建议”的文本里。
- **把事实写进城市 skill。** 不需要新模块，但 skill 是模型可以忽略的散文，服务端无法比对，且每个城市上限 4500 字符。
- **每轮调用 Google Place Details 取实时营业时间。** 没有密钥，线上服务目前不调用 Google，条款不允许缓存营业时间。保留为付费验证的接缝。

## 待确认的问题与风险

1. 冲突时默认只标注，还是自动重排一次？重排会给有冲突的新草稿多一次模型调用。
2. 匹配不到记录的站点怎么显示：全部标“未核实”、不显示，还是只在已覆盖的城市里标？
3. 局部施工（兴福寺五重塔）而站点没有提到该部分时，是提醒还是不显示？
4. 第一批覆盖四个城市 skill 里列出的约 52 个地点，还是先只做审计涉及的十来个，验证效果后再扩？
5. `placeFacts` 在目的地认不出城市（例如“关西”）时，是给全部记录（约 52 行）还是不给？
6. 谁运行 `places:lint`、多久一次？默认 180 天是否合适？
7. Google 密钥何时提供？在那之前所有记录都是 `unpinned`，实时字段的接缝没有可以关联的 ID。
8. 风险：事实本身的准确性是最大风险。错误的记录比没有记录更糟，因为它会以“已核实”的面目出现。防线只有评审和定期复核。
9. 风险：`stop.check` 是嵌套的联合类型，以后新增取值会让旧客户端解析 `done` 失败，需要前端先发布。
10. 风险：到达方式的检查读的是站点备注，交通段如果被折进了相邻站点的备注会张冠李戴。测试要用审计里的真实原文。
11. 已有缺口：`infra/compose/Dockerfile.chat` 没有把 `skills/` 带进镜像。本设计不依赖它，但也没有修它。

## 要改的现有文件

| 文件 | 改动 |
|---|---|
| `packages/contracts/src/trip-flow.ts` | 嵌套 stop 增加 `check`（可空）。顶层不动 |
| `services/chat/src/trip/state.ts` | `toTripView` 把每个站点的核对结果经 `copy` 和策略映射到视图。状态结构不变 |
| `services/chat/src/trip/copy.ts` | 新增核对说明的中英文文案 |
| `services/chat/src/trip/llm.ts` | `context()` 增加 `placeFacts`、`placeChecks`；`SKILL_FACTS_RULE` 允许陈述这些事实 |
| `services/chat/src/trip/effect.ts` | 仅在策略为重排时增加一次定向 revise |
| `clients/chat-web/features/panels/LiveTripPanels.tsx` | 每个站点增加核对标记（HeroUI Chip + Tooltip） |
| `clients/chat-web/messages/{en,zh}.json` | 新增 `panels.live.check.*` |
| `services/chat/evals/experiment.ts`、`evaluators/places.ts`、`thresholds.json` | 新评分器；阈值在 A/A 噪声运行后再加 |
| `services/chat/.oxlintrc.json` | `places` 的纯文件名单和内部文件导入限制 |
| `services/chat/skills/japan-nara/SKILL.md` | 去掉“五重塔” |

## 下一步

先写 `src/places/check.spec.ts`：用审计的真实案例做固定记录，每个案例断言具体的 `Finding`（东本愿寺 12 月 16:00、兴福寺五重塔、筑地休市日、伏见稻荷“乘地铁”、关西机场“乘地铁”），再实现 `record.ts` 和 `check.ts` 直到通过。在这之前不动任何 `trip/` 文件。

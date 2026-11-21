# 地点知识库（LLM Wiki）设计

日期：2026-11-21
状态：草案，未实现。取代 `2026-11-18-place-facts-design.md`（其中的按日期核对已在分支 `refactor/remove-place-checks` 上移除）。本文的上一版是"结构化页头加过滤搜索"，已按决定改为 LLM Wiki。

## 已经定下的事

这些是产品决定，本文不再讨论：

- 知识库是 **LLM Wiki**：由模型把来源整理成互相链接的 markdown 页面并持续维护；编排行程的模型通过工具从目录页逐层读进去。
- 用途是**供给**，不做写后核查。
- 范围是景点、区域、静态交通信息。交通耗时和换乘不做。
- 餐馆只维护一份人工精选清单。
- 内容要定期更新。

## 问题

模型现在写行程靠两样东西：自己的记忆，和城市 skill（`services/chat/skills/japan-kyoto/SKILL.md` 等）。

城市 skill 是一份 1–2 KB 的清单，开头就写着"Suggestions only, not checked facts"。京都那份列了 17 个景点，每个一行，没有区域、没有时间、没有来源。提示词因此禁止模型写开放时间这类具体事实，行程里只能写"请自行核实"。

`src/places/records/` 里有 18 个地点的带来源事实，但它是为核查设计的：只有时间类字段，模型不能查阅，只在上下文里收到几行 `placeFacts`。

缺的是一个内容够用、能从城市读到区域再读到具体地点、每条事实有出处、并且能保持新鲜的库。

现有系统对设计的约束：

- 每轮最多 7 个工具轮次（`MAX_TOOL_ROUNDS`），用完后强制收尾。加载 skill、搜酒店、`show_results` 已经占用一部分。
- 单个工具结果超过 12 000 字符会被截断（`MAX_RESULT_LENGTH`）。
- `state.toolResults` 最多存 8 条。`load_skill` 的结果不计入（`unrecorded`）。
- 镜像只复制 `dist`（`infra/compose/Dockerfile.chat`），`skills/` 目录至今没进镜像。
- 仓库是公开的，不能存官方页面全文。Google 只允许长期保存 place ID。
- CI 没有定时任务，也没有模型密钥。

## LLM Wiki 的三层

按 Karpathy 描述的结构，对应到这个项目：

| 层 | 是什么 | 在这里 |
| --- | --- | --- |
| 来源 | 原始资料，只读 | 官方页面。全文只放本地缓存（不入库），库里只记清单：链接、抓取日期、内容哈希 |
| Wiki | 模型写、模型维护的 markdown 页面，互相链接，有目录和日志 | `services/chat/knowledge/wiki/` |
| 规约 | 告诉维护模型怎么写的说明 | `services/chat/knowledge/SCHEMA.md` |

三种操作：

- **Ingest（录入）**：维护模型读一个来源，写或更新受影响的所有页面，更新目录，追加日志。
- **Query（查询）**：编排行程的模型从目录读起，顺着链接读到需要的页面。
- **Lint（体检）**：维护模型加脚本定期检查矛盾、过期、孤立页面、缺失的链接。

## 用法

**模型写京都行程。** 系统提示词里列出各城市的入口页。模型按链接逐层读：

```jsonc
// 第 1 轮（和 load_skill、搜酒店并行）
read_wiki({ "pages": ["kyoto"] })
// → 京都目录页：区域列表、专题页（红叶、雨天、交通、餐馆精选），每项一行说明

// 第 2 轮
read_wiki({ "pages": ["kyoto/higashiyama", "kyoto/fushimi", "kyoto/autumn-leaves"] })
// → 区域页：这一带的地点、怎么组合成半天或一天；每个地点带链接

// 第 3 轮
read_wiki({ "pages": ["kyoto/kiyomizu-dera", "kyoto/tofuku-ji", "kyoto/fushimi-inari-taisha"] })
// → 地点页：是什么、看什么、什么时候去、实用信息（带出处）
```

**维护者录入一个新来源。** 在 Claude Code 里对知识库目录发起一次会话：

```
按 knowledge/SCHEMA.md 录入 https://tofukuji.jp/
```

维护模型抓取页面、写 `kyoto/tofuku-ji.md`、在 `kyoto/fushimi.md` 和 `kyoto/autumn-leaves.md` 里加上链接、更新 `kyoto.md` 目录、在 `log.md` 追加一行，然后跑 `bun run wiki:check`。结果是一个 git diff。

**定期更新。** 同样是一次维护会话，指令是"按 SCHEMA.md 做体检并重刷核对日期最旧的 10 页"。

## 形状

### 目录结构

```
services/chat/knowledge/
  SCHEMA.md                     规约：页面类型、章节、引用格式、链接规则、三种操作的步骤
  sources.json                  来源清单：url、fetchedOn、sha256、被哪些页面引用
  raw/                          来源全文的本地缓存，gitignore
  wiki/
    index.md                    总目录：各城市入口
    log.md                      追加式日志：日期、操作、涉及的页面
    kyoto.md                    城市目录页
    kyoto/
      higashiyama.md            区域页
      kiyomizu-dera.md          地点页
      autumn-leaves.md          专题页
      getting-around.md         静态交通页
      restaurants.md            餐馆精选（人工）
    osaka.md
    osaka/ …
```

页面 id 是相对 `wiki/` 的路径去掉 `.md`，例如 `kyoto/kiyomizu-dera`。链接写成 `[[kyoto/kiyomizu-dera]]`。

### 页面

页面是文章，不是数据记录。页头很薄，只放索引和维护需要的东西：

```markdown
---
title: Higashi Hongan-ji
names: { zh: 东本愿寺, ja: 東本願寺 }
aliases: [Higashi Honganji, 真宗本庙]
type: place            # city | area | place | topic | curated
updated: 2026-11-21
placeId: ChIJkWH_sqUIAWARWsn28jWc7y0
---
Head temple of the Otani branch of Shin Buddhism, ten minutes on foot north of
Kyoto Station in [[kyoto/kyoto-station]].

## Worth seeing
The Founder's Hall is one of the largest wooden buildings in the world. …

## When to go
Quiet early in the morning. Pairs well with [[kyoto/nishi-hongan-ji]] on an arrival day.

## Practical
- Open 05:50–17:30 from March to October and 06:20–16:30 from November to February.[^hours]
- Reachable by JR, subway and private rail via Kyoto Station.[^access]
- Free entry.[^hours]

[^hours]: https://www.higashihonganji.or.jp/worship/access/ · checked 2026-11-19 · "3月～10月 5:50～17:30 11月～2月 6:20～16:30"
[^access]: …
```

规约里的硬性规则：

- **正文用英文。** 和 skill、提示词一致。名称保留中、英、日三种写法。
- **具体事实（时刻、日期、价格、闭馆、施工、轨道种类）只写在 `## Practical` 里，每条带脚注。** 脚注格式固定：来源链接、核对日期、不超过 300 字的原文引句。
- **`## Practical` 以外的章节是编辑性描述**，可以不带出处，但不许出现时刻、价格、日期。
- **每个页面至少被一个页面链接**，并出现在所属城市的目录页里。
- **单页渲染后不超过 1 800 字符。** 超了就拆成子页面并互相链接。这同时保证一次读 6 页不超过工具结果上限。
- 现有 18 条记录转成地点页：原来的 `hours`、`closures`、`access` 各变成 `## Practical` 里的一行，`source` / `quote` / `checkedOn` 变成脚注。

### 查询：一个工具，从目录读起

```ts
read_wiki({ pages: string[] })   // 最多 6 页，返回每页的全文
```

- 系统提示词列出入口页（`kyoto`、`osaka`、`tokyo`、`nara`），就像现在列出可加载的 skill。
- 目录页分两层：城市页列区域和专题，区域页列地点。这样城市页不会随地点数量变长。
- 请求了不存在的页面时，返回一行说明并列出同目录下的页面 id，同时记一条日志（见"评测"里的 `wiki_miss`）。
- 结果不存进 `state.toolResults`，和 `load_skill` 一样放进 `unrecorded`。
- 页面在启动时全部读入内存，读取方式照搬 `skills/registry.ts`。

**不提供搜索工具。** LLM Wiki 的访问方式就是目录加链接。几百页的规模下，两层目录够用。如果以后模型经常找不到已有的页面，再考虑加搜索。

### 日期交给模型判断，服务端只给日历

事实现在写在文章里，服务端不再能算"你的日期上是否开放"。为了让模型自己判断时少出错，`serverContext` 增加一项：

```jsonc
"tripDates": ["2026-11-22 Sun", "2026-11-23 Mon (public holiday)", "2026-11-24 Tue", "2026-11-25 Wed"]
```

星期和日本公共假日由服务端给出（沿用现有的假日表）。模型拿着这个去对照页面里的"周三休息""逢假日顺延"。

### 提示词与状态

- `serverContext.placeFacts` 去掉。
- `FACTS_RULE` 改成"具体事实只能来自工具结果"。Wiki 页面里的开放时间可以写进行程。
- skill 列表后的指令补充：对每个要规划的城市，第一轮就读它的目录页；每一轮把要读的页面一次请求完。
- 不新增 SSE 事件和组件类型。面板不变。

### 维护：模型写，脚本查，人评审

维护不在聊天服务里跑，是对 `knowledge/` 目录的 Claude Code 会话，按 `SCHEMA.md` 执行。

**Ingest** 的步骤（写在规约里）：

1. 抓取来源，全文存入 `raw/`，在 `sources.json` 登记链接、日期、哈希。
2. 写或更新地点页。事实进 `## Practical` 并带脚注。
3. 更新受影响的区域页、专题页、城市目录页，补上链接。
4. 在 `log.md` 追加一行。
5. 跑 `bun run wiki:check`，全部通过才算完成。

**`wiki:check`** 是确定性脚本，也进 CI：

- 每个 `[[链接]]` 指向存在的页面；没有孤立页面；目录页覆盖全部页面。
- `## Practical` 里每条都有脚注，脚注格式正确。
- `## Practical` 以外没有时刻、价格、日期。
- 页面长度不超限；别名不重复。
- 本地有 `raw/` 缓存时，**每条引句必须逐字出现在对应来源的缓存里**。这一步不靠模型，用来挡住编造的出处。CI 里没有缓存，这一项跳过。
- 列出核对日期超过 180 天的脚注（警告，不算失败）。

**Lint** 是模型做的体检：页面之间的矛盾、被新来源推翻的说法、值得单独成页的概念、缺失的交叉链接。产出同样是 diff 加一条日志。

**运行时不回写。** 原版 LLM Wiki 会把查询中得到的好答案存回 wiki。这里的查询来自终端用户的聊天，内容不可信也涉及隐私，所以聊天服务对 wiki 只读。聊天侧只贡献一样东西：`wiki_miss` 日志，告诉维护者模型想读而没有的页面。

### 餐馆

- 每个城市一页 `restaurants.md`，`type: curated`。
- 人工写。规约规定维护模型不改写 `curated` 页面的内容，只负责让其他页面链接到它。
- 每家店一段：区域、菜系、价位档、是否需要预约、官方链接。写了营业时间就必须带脚注。
- 建议每个城市起步 10–15 家。

### 交通

每个城市一页 `getting-around.md`：通票怎么选、机场怎么进城、哪些区域之间适合步行。地点页的 `## Practical` 里写可达的轨道种类。

不写耗时、线路名、换乘。提示词里"每段交通只写方式"的规则保持不变。

### 模块

```
services/chat/src/knowledge/
  page.ts        页头 schema、解析、链接提取
  library.ts     读 wiki 目录、校验、按 id 建索引
  read-tool.ts   read_wiki 工具
  dates.ts       tripDates：星期和假日标注（假日表从 src/places 移来）
  check.ts       wiki:check 的规则，纯函数
  index.ts       唯一对外入口
```

`src/places/` 整个删除。城市 skill 在对应城市的 wiki 上线时删除，内容并入城市页和区域页。`japan-travel` skill 是规则，不是知识，保持不变。

### 部署

`Dockerfile.chat` 增加复制 `services/chat/knowledge/wiki/` 和 `services/chat/skills/`。后者是现存的遗漏，一并修掉。

### 评测

- `wiki_read`：涉及已覆盖城市的行程轮次里，读过 wiki 的比例。模型不读就等于没有知识库，这是首要指标。
- `wiki_depth`：每个行程读到地点页的数量。只读了目录页就开写，说明导航没走通。
- `wiki_stop_share`：行程站点里能按标题或别名对上 wiki 页面的比例。衡量覆盖面。
- `wiki_miss`：请求了不存在的页面的次数。
- `rounds_exhausted`：用完 7 个工具轮次被强制收尾的比例。逐层读会多占轮次，这个指标盯的是副作用。
- live 脚本加断言：京都草稿至少读了一个地点页。

提示词和工具都变了，评测的回放和基线需要用真实模型重建。

## 明确不做

- 不做写后核查，不做自动修复。
- 不做交通耗时、换乘、线路。
- 不抓取餐馆平台的数据。
- 不做向量检索，不做搜索工具。
- 聊天服务不写 wiki，运行时不联网。
- 来源全文不入库。

## 接受的取舍

- **多占工具轮次。** 目录、区域、地点要三轮，加上酒店和 `show_results`，多城市行程可能碰到 7 轮上限。先不调上限，用 `rounds_exhausted` 观察。
- **事实写在文章里，服务端不能计算。** "这一天是否开放"由模型对照 `tripDates` 自己判断。2026-11-18 的审计里，模型在这类判断上出过错（筑地排在周三），去掉核查后不会被拦住。
- **模型维护的文字可能漂移。** 多次改写后，描述可能偏离来源。约束手段是：事实集中在 `## Practical`、每条带引句、引句逐字校验、每次改动经人评审。
- **更新需要发版。** 页面在 git 里，合并后重新部署才生效。
- **模型可能不读。** 是否调用工具由模型决定，`wiki_read` 用来盯这个。

## 备选方案

- **结构化页头加过滤搜索（本文上一版）。** 一步搜到、服务端能算日期、省轮次。落选是产品决定：要的是 LLM Wiki。它的 `onYourDates` 是这次放弃的最有价值的部分。
- **经典 RAG。** 模型拿到的是片段，可能互相矛盾，无法判断新旧；公开仓库存原文有版权顾虑。
- **Wiki 页面存数据库，更新不发版。** 失去 git 评审和 diff。更新频率按周时不需要即时生效。
- **聊天侧把好答案回写 wiki。** 原版做法，但来源是终端用户，内容不可信，落选。

## 待确认的问题

1. **维护会话谁来跑、多久一次？** 建议每周一次，在本机用 Claude Code 的定时任务跑（`raw/` 缓存在本机，引句校验才有效），产出 PR，人评审后合并。放进 GitHub Actions 则需要模型密钥，而且没有缓存。
2. **先做哪个城市？** 建议先把京都做完整：1 个城市页、约 8 个区域页、约 40 个地点页、3–4 个专题页、交通页、餐馆页。用评测看效果再铺开。
3. **餐馆名单由谁选？** 选店需要你定，整理成页面我来做。
4. **城市 skill 过渡期怎么处理？** 建议京都 wiki 上线的同时删掉 `japan-kyoto`，避免模型同时拿到两份说法。
5. **工具轮次上限要不要从 7 调到 9？** 建议先不调，看 `rounds_exhausted`。
6. **推理轨迹面板要不要显示读了哪些页面？** 按本设计不显示。

## 要改的现有文件

| 文件 | 改动 |
| --- | --- |
| `services/chat/src/places/**` | 删除；假日表移入 `src/knowledge/dates.ts` |
| `services/chat/src/trip/llm.ts` | 绑定 `read_wiki` 并加入 `unrecorded`；去掉 `placeFacts`，加 `tripDates`；改 `FACTS_RULE`；提示词列出入口页 |
| `services/chat/src/trip/llm.spec.ts` | 去掉 `placeFacts` 的断言和记录 mock，加工具绑定和 `tripDates` 的断言 |
| `services/chat/skills/japan-travel/SKILL.md` | 第 60 行引用 `serverContext.placeFacts`，改为 wiki 页面 |
| `services/chat/skills/japan-{kyoto,osaka,tokyo,nara}/` | 对应城市 wiki 上线时删除 |
| `services/chat/scripts/places-{lint,pin}.ts` | 删除 `places-lint`，由 `wiki-check.ts` 取代；`places-pin` 改为读写页头的 `placeId` |
| `services/chat/package.json` | 脚本改名与新增 |
| `services/chat/.oxlintrc.json` | `places` 的导入限制改为 `knowledge` |
| `services/chat/.gitignore` | 加 `knowledge/raw/` |
| `services/chat/evals/**` | 新增五个指标；重录回放，重建基线 |
| `services/chat/scripts/test-trip-live.ts` | 新增"京都草稿读了地点页"的断言 |
| `infra/compose/Dockerfile.chat` | 复制 `knowledge/wiki/` 和 `skills/` |
| `.github/workflows/ci.yml` | 跑 `wiki:check` |
| `CLAUDE.md` | places 段落改为 knowledge |

## 下一步

分四步，每一步都能单独验证：

1. **骨架。** `SCHEMA.md`、`src/knowledge/`、`read_wiki`、`wiki:check`、`tripDates`、提示词改动、镜像修复。把 18 条现有记录转成地点页，补上它们所在的城市目录页。先写 `check.spec.ts` 和 `library.spec.ts`。跑 live 脚本。
2. **京都试点内容。** 按规约录入区域页、地点页、专题页、交通页、餐馆页。重建评测基线，看 `wiki_read`、`wiki_depth`、`rounds_exhausted`。
3. **维护流程。** 定时的体检与重刷会话，`wiki_miss` 日志接入。
4. **其余城市。** 铺开内容，删除对应的城市 skill。

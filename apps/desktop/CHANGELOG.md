# Changelog

## [0.1.3](https://github.com/ChurroStack/churro-coder/compare/v0.1.2...v0.1.3) (2026-06-04)


### Bug Fixes

* **desktop:** right-sidebar data leaks + CLI-harness MCP/plan/status fixes ([#182](https://github.com/ChurroStack/churro-coder/issues/182)) ([4f57ca3](https://github.com/ChurroStack/churro-coder/commit/4f57ca3bddab63edbbb6829334a6d8632c2250e3))

## [0.1.2](https://github.com/ChurroStack/churro-coder/compare/v0.1.1...v0.1.2) (2026-05-30)


### Bug Fixes

* **desktop:** build macOS installers (arm64-only, ad-hoc signed) ([#180](https://github.com/ChurroStack/churro-coder/issues/180)) ([d2a23f7](https://github.com/ChurroStack/churro-coder/commit/d2a23f71baa0bd5d22c434cbaceb5c69acbd332b))

## [0.1.1](https://github.com/ChurroStack/churro-coder/compare/v0.1.0...v0.1.1) (2026-05-30)


### Bug Fixes

* **desktop:** unblock release installers by dropping node-abi override ([#178](https://github.com/ChurroStack/churro-coder/issues/178)) ([505f1be](https://github.com/ChurroStack/churro-coder/commit/505f1be4aa3a31ecc186cdda032d799d30483ec2))

## 0.1.0 (2026-05-29)


### Features

* add close button to worktree config banner ([#99](https://github.com/ChurroStack/churro-coder/issues/99)) ([7aa8602](https://github.com/ChurroStack/churro-coder/commit/7aa8602e92c2ac13c96d446844b68b3acf602788))
* add dual-mount race handling to plan approval ([#73](https://github.com/ChurroStack/churro-coder/issues/73)) ([7f50692](https://github.com/ChurroStack/churro-coder/commit/7f50692c454c4b2bc3c80aa1a49f798ed356249f))
* add Project statistics page powered by local git history ([#96](https://github.com/ChurroStack/churro-coder/issues/96)) ([dea9b3a](https://github.com/ChurroStack/churro-coder/commit/dea9b3a552b789b29dcf9d6b4b3cc3c1eba79991))
* AI commit messages with title + description (Claude → Ollama → heuristic) ([#42](https://github.com/ChurroStack/churro-coder/issues/42)) ([68ada27](https://github.com/ChurroStack/churro-coder/commit/68ada2712a9a5d5de308269f02c9b3a7c01245f4))
* centralize agent prompts as Nunjucks templates with user-override support ([#94](https://github.com/ChurroStack/churro-coder/issues/94)) ([a352771](https://github.com/ChurroStack/churro-coder/commit/a3527715439390551ee48125d0ec74c673340fda))
* **claude:** unified failure recovery with silent retry ([#106](https://github.com/ChurroStack/churro-coder/issues/106)) ([c2086e7](https://github.com/ChurroStack/churro-coder/commit/c2086e7528e556cb3eaca76b7f1128dc427559cb))
* CLI harness, chat surface router, and /opsx Enter fix ([#157](https://github.com/ChurroStack/churro-coder/issues/157)) ([66becf8](https://github.com/ChurroStack/churro-coder/commit/66becf813504bfce62e0739cbe6d47ae2974cfec))
* CLI harness, chat surface router, MCP improvements, and session resilience ([#158](https://github.com/ChurroStack/churro-coder/issues/158)) ([4fd9f0d](https://github.com/ChurroStack/churro-coder/commit/4fd9f0d242d8a40d29c92962a3128a3650a9cf22))
* Codex plan mode — read-only sandbox, plan approval badge, normalizer improvements ([#10](https://github.com/ChurroStack/churro-coder/issues/10)) ([#10](https://github.com/ChurroStack/churro-coder/issues/10)) ([cda32ce](https://github.com/ChurroStack/churro-coder/commit/cda32ce1ca1eb78de099c619b73a3827c780c7eb))
* **codex:** resilient app-server recovery with retry/restart ([#103](https://github.com/ChurroStack/churro-coder/issues/103)) ([ebf5439](https://github.com/ChurroStack/churro-coder/commit/ebf5439ad0ad29564262ca1c29f2b13716d1d8f4))
* **desktop:** add font-size slider to markdown viewer ([#156](https://github.com/ChurroStack/churro-coder/issues/156)) ([89a518b](https://github.com/ChurroStack/churro-coder/commit/89a518b18c90d061074e45ede8d24240e1345529))
* **desktop:** add native speech fallback ([#136](https://github.com/ChurroStack/churro-coder/issues/136)) ([58f7840](https://github.com/ChurroStack/churro-coder/commit/58f784054b35469cc842c7be0445a96186e43945))
* **desktop:** add sticky Apply-mode toggle to OpenSpec notch ([#147](https://github.com/ChurroStack/churro-coder/issues/147)) ([68ac8b3](https://github.com/ChurroStack/churro-coder/commit/68ac8b3f069bc76b1f95a64c7c43add504f998b9))
* **desktop:** AI-generated chat titles for long prompts ([#115](https://github.com/ChurroStack/churro-coder/issues/115)) ([1456e1e](https://github.com/ChurroStack/churro-coder/commit/1456e1e64c1bd0471b6f580b16fe0f7c7d75c72e))
* **desktop:** allow read-only Bash + WebFetch in plan/explore modes ([#120](https://github.com/ChurroStack/churro-coder/issues/120)) ([0b052f0](https://github.com/ChurroStack/churro-coder/commit/0b052f0c9015b25b333aab3846a3403d064d7c62))
* **desktop:** artifact-driven Review milestone + cross-surface drift fixes ([#119](https://github.com/ChurroStack/churro-coder/issues/119)) ([f17863b](https://github.com/ChurroStack/churro-coder/commit/f17863b9e0626503a8ebc24695fb976853dbb114))
* **desktop:** auto-import keychain token before Claude login dialog ([#137](https://github.com/ChurroStack/churro-coder/issues/137)) ([afb8699](https://github.com/ChurroStack/churro-coder/commit/afb8699a1b476ddd5be9465b2fa300500d7b3b11))
* **desktop:** churro-memory MCP server with cross-provider read_plan tool ([#66](https://github.com/ChurroStack/churro-coder/issues/66)) ([b9edce5](https://github.com/ChurroStack/churro-coder/commit/b9edce595b81a46ebad0076296e322da7fc05f53))
* **desktop:** detect stuck Continue button and add hard-restart action ([#152](https://github.com/ChurroStack/churro-coder/issues/152)) ([02b59e5](https://github.com/ChurroStack/churro-coder/commit/02b59e570410a60498ca6f0214b45985fcfb68b0))
* **desktop:** native --resume + JSONL ingestion + voice-only CLI prompt ([#166](https://github.com/ChurroStack/churro-coder/issues/166)) ([b56e735](https://github.com/ChurroStack/churro-coder/commit/b56e7358180d2a27eb57823c909c3b5a5b8878f2))
* **desktop:** New Project wizard + clean-tree invariant for openspec archive ([#148](https://github.com/ChurroStack/churro-coder/issues/148)) ([9a5771f](https://github.com/ChurroStack/churro-coder/commit/9a5771fba63bb458afd323534d4803a9f3825f5e))
* **desktop:** SDLC state machine kanban with attention overlay ([#114](https://github.com/ChurroStack/churro-coder/issues/114)) ([76b5684](https://github.com/ChurroStack/churro-coder/commit/76b5684b0b389211e2c2da18212b769081bbdbf5))
* **desktop:** show /folder:filename in slash-command popover ([#153](https://github.com/ChurroStack/churro-coder/issues/153)) ([31a7673](https://github.com/ChurroStack/churro-coder/commit/31a7673da80528b19c93c09c424368f10b60e4e5))
* **desktop:** show workspace icon in Archived workspaces popover ([#65](https://github.com/ChurroStack/churro-coder/issues/65)) ([1d35626](https://github.com/ChurroStack/churro-coder/commit/1d35626cfe2b1cd0ae676e8d90de740c235c9f4f))
* **desktop:** wire Sentry crash reporting + feedback dialog ([#61](https://github.com/ChurroStack/churro-coder/issues/61)) ([e407d80](https://github.com/ChurroStack/churro-coder/commit/e407d8044d237361623585c85eced2f4a035c754))
* free up sidebar logo for window-drag, move Shortcuts to bottom rail ([#21](https://github.com/ChurroStack/churro-coder/issues/21)) ([c23746d](https://github.com/ChurroStack/churro-coder/commit/c23746d70e6ac775378a8f6bcb584e1ff8be5a7e))
* **landing:** add GDPR-compliant cookie consent with Google Analytics opt-in ([#143](https://github.com/ChurroStack/churro-coder/issues/143)) ([12078d5](https://github.com/ChurroStack/churro-coder/commit/12078d5402ca49491e1a2b3d87857d1a6476470c))
* **landing:** add Next.js marketing site with i18n (en/es) and SEO ([#60](https://github.com/ChurroStack/churro-coder/issues/60)) ([faf5f65](https://github.com/ChurroStack/churro-coder/commit/faf5f655dec6188afabcec49dd9f37f0d408562c))
* make usage models table sortable ([#34](https://github.com/ChurroStack/churro-coder/issues/34)) ([ec7c921](https://github.com/ChurroStack/churro-coder/commit/ec7c921f24caf5802503de9888afeb971eb61fa4))
* multi-provider interleaved conversations (Claude ↔ Codex soft handoff) ([#8](https://github.com/ChurroStack/churro-coder/issues/8)) ([94de54e](https://github.com/ChurroStack/churro-coder/commit/94de54e73ada7f36b28d4445057ebd81dfd37604))
* per-chat status icons in dockview tabs ([#2](https://github.com/ChurroStack/churro-coder/issues/2)) ([a282148](https://github.com/ChurroStack/churro-coder/commit/a2821480051223d44602e93424db0c17293f8ebf))
* sandbox Claude Code and Codex filesystem access ([#20](https://github.com/ChurroStack/churro-coder/issues/20)) ([de4b15a](https://github.com/ChurroStack/churro-coder/commit/de4b15a97788b727f9ce30647e2230c20c35db63))
* stale-PR detection in Status widget + worktree deletion warnings ([#76](https://github.com/ChurroStack/churro-coder/issues/76)) ([59bb638](https://github.com/ChurroStack/churro-coder/commit/59bb6388c180c6ea2695e753293247adefc0ea5f))
* Status widget — Plan → Code → Review → PR stepper ([#13](https://github.com/ChurroStack/churro-coder/issues/13)) ([cc0761b](https://github.com/ChurroStack/churro-coder/commit/cc0761bd900538074430fb0703fd96680ef50eea))
* UI polish + provider signal capture ([#6](https://github.com/ChurroStack/churro-coder/issues/6)) ([#6](https://github.com/ChurroStack/churro-coder/issues/6)) ([8395ee9](https://github.com/ChurroStack/churro-coder/commit/8395ee97d229358d7f70b49aedee784485226cc0))
* update 6 files ([#43](https://github.com/ChurroStack/churro-coder/issues/43)) ([b4b8f97](https://github.com/ChurroStack/churro-coder/commit/b4b8f97560e88bad59da6452ede815209fe146ab))
* update chats.ts, agents-sidebar.tsx, agents-archive-popover.tsx ([#49](https://github.com/ChurroStack/churro-coder/issues/49)) ([aebba72](https://github.com/ChurroStack/churro-coder/commit/aebba725e88f709dd4646d0c5225bd68af33e573))


### Bug Fixes

* apply Plan/Agent/Review default model and thinking across all actions ([#32](https://github.com/ChurroStack/churro-coder/issues/32)) ([5f9cbee](https://github.com/ChurroStack/churro-coder/commit/5f9cbeeb04b13b79b5b5e65426122e9719676022))
* approve plan now correctly switches sub-chat to agent mode ([#40](https://github.com/ChurroStack/churro-coder/issues/40)) ([8c4646e](https://github.com/ChurroStack/churro-coder/commit/8c4646e4ed7c3fa025fb8238d73d85c2ccfe1d39))
* bind form model/mode selection to new sub-chat on creation ([#38](https://github.com/ChurroStack/churro-coder/issues/38)) ([4d55ade](https://github.com/ChurroStack/churro-coder/commit/4d55ade03a95b48e6b22579df0c1879751fdc8ed))
* Build issues — non-array cache + App/AgentsLayout fixups ([#85](https://github.com/ChurroStack/churro-coder/issues/85)) ([239a53f](https://github.com/ChurroStack/churro-coder/commit/239a53fc61814c50192a5df3bda18f04eea9f07f))
* Build OOM ([#84](https://github.com/ChurroStack/churro-coder/issues/84)) ([d58079e](https://github.com/ChurroStack/churro-coder/commit/d58079e18c2c9d182ce26c33ea705d7c62fbd270))
* Changes UI "This chat" badge always 0 + residual Review-button crash sites ([#19](https://github.com/ChurroStack/churro-coder/issues/19)) ([85cff49](https://github.com/ChurroStack/churro-coder/commit/85cff49bc772a2b11d8abb72d8275216229d9d89))
* changes window UX — activate chat on action, align title, preserve full names ([#5](https://github.com/ChurroStack/churro-coder/issues/5)) ([43eb337](https://github.com/ChurroStack/churro-coder/commit/43eb337892cdf2d8526cafa3648aa7338202e927))
* **ci:** split monolithic workflow per app + harden flaky popover test ([#173](https://github.com/ChurroStack/churro-coder/issues/173)) ([496bfee](https://github.com/ChurroStack/churro-coder/commit/496bfee084f06ad1959d7cee0402c825c641f99d))
* **codex:** prevent stale cleanup from aborting implement-plan stream and stop re-planning in agent mode ([#72](https://github.com/ChurroStack/churro-coder/issues/72)) ([acd7270](https://github.com/ChurroStack/churro-coder/commit/acd72700a305d3a5a90943e7742717bece246839))
* **codex:** stop leaking Claude session UUIDs into Codex thread/resume ([#70](https://github.com/ChurroStack/churro-coder/issues/70)) ([fa6c7ef](https://github.com/ChurroStack/churro-coder/commit/fa6c7ef64dc1204801d93221a85df2e218e7d0c1))
* constrain long tooltip text ([#30](https://github.com/ChurroStack/churro-coder/issues/30)) ([6f99fbc](https://github.com/ChurroStack/churro-coder/commit/6f99fbc8d4ec983f7909d7e2ff6d9bae0c5bdba7))
* corrupted/sparse projects array ( ([#97](https://github.com/ChurroStack/churro-coder/issues/97)) ([58d1a02](https://github.com/ChurroStack/churro-coder/commit/58d1a02581566ceb0a988193d6c55c25ab3837ae))
* cross-provider plan-approval crash (Codex GPT-5.5 → Claude Sonnet) ([#52](https://github.com/ChurroStack/churro-coder/issues/52)) ([127a87a](https://github.com/ChurroStack/churro-coder/commit/127a87a176a48f651cd8900b224cd8702fa68337))
* **desktop:** always pin chat to bottom on tab switch ([#113](https://github.com/ChurroStack/churro-coder/issues/113)) ([343dc05](https://github.com/ChurroStack/churro-coder/commit/343dc050ef47ce81ca223bcd0478c0b9336cea4b))
* **desktop:** auto-close Claude login modal once token is obtained ([#55](https://github.com/ChurroStack/churro-coder/issues/55)) ([71c4431](https://github.com/ChurroStack/churro-coder/commit/71c4431d924f5efb1da357ae009aa1439a02f4c3))
* **desktop:** block dismissal of Add Project dialog in empty state ([#162](https://github.com/ChurroStack/churro-coder/issues/162)) ([1f37f65](https://github.com/ChurroStack/churro-coder/commit/1f37f6527ec6df77506075ee7ddb3f860781a5ea))
* **desktop:** bypass Claude permission prompt on /opsx:apply turns ([#155](https://github.com/ChurroStack/churro-coder/issues/155)) ([c52457f](https://github.com/ChurroStack/churro-coder/commit/c52457fd03d7c1f5e698e3ac38a1fcb841d9f08e))
* **desktop:** dedupe first user message in CLI subchat conversation pane ([#168](https://github.com/ChurroStack/churro-coder/issues/168)) ([cea1acf](https://github.com/ChurroStack/churro-coder/commit/cea1acffa27f2a2554f791fd7b0f1c5ac4444072))
* **desktop:** detect Claude CLI native ExitPlanMode plans during ingestion ([#171](https://github.com/ChurroStack/churro-coder/issues/171)) ([889d323](https://github.com/ChurroStack/churro-coder/commit/889d323a7912cb83be0b84d565cc4b7d40f5e76e))
* **desktop:** disable plan/review action buttons while chat is streaming ([#150](https://github.com/ChurroStack/churro-coder/issues/150)) ([440b34f](https://github.com/ChurroStack/churro-coder/commit/440b34f7caf526dd6315fbc34e857cbb01e4d123))
* **desktop:** global CLI busy-state subscriber survives dockview tab switches ([#165](https://github.com/ChurroStack/churro-coder/issues/165)) ([d1e23cd](https://github.com/ChurroStack/churro-coder/commit/d1e23cd0e2d281c09a7e9b0f7a2a2b2218aebbd4))
* **desktop:** harden CLI idle-detection against tab-switch and resize false positives ([#172](https://github.com/ChurroStack/churro-coder/issues/172)) ([694b76c](https://github.com/ChurroStack/churro-coder/commit/694b76c2822b4049c2cd4baa3b76276e48f4e189))
* **desktop:** isolate Claude CLI sub-chat sessions via --session-id ([#170](https://github.com/ChurroStack/churro-coder/issues/170)) ([aa7fee5](https://github.com/ChurroStack/churro-coder/commit/aa7fee573464d8441e50ab1e199bf56798928d61))
* **desktop:** mode dropdown stays on Plan after clicking Execute in new chat ([#146](https://github.com/ChurroStack/churro-coder/issues/146)) ([b93b0e4](https://github.com/ChurroStack/churro-coder/commit/b93b0e4971b2f1b6135715fbbc2ef18bf9fe81b8))
* **desktop:** mode dropdown stays stale after picking Explore/Execute ([#151](https://github.com/ChurroStack/churro-coder/issues/151)) ([9609168](https://github.com/ChurroStack/churro-coder/commit/96091680486a7ac14dde7d6672ec72e4a99c34c6))
* **desktop:** open new terminals at 70/30 split instead of 50/50 ([#167](https://github.com/ChurroStack/churro-coder/issues/167)) ([c92af7a](https://github.com/ChurroStack/churro-coder/commit/c92af7a7f30ece2e9cf70825e9c498600acc1724))
* **desktop:** persist file and pasted-text attachments in new-chat draft ([#110](https://github.com/ChurroStack/churro-coder/issues/110)) ([aa66178](https://github.com/ChurroStack/churro-coder/commit/aa66178b41d84582b189992a97d28466f1cb0c11))
* **desktop:** pin @opentelemetry/api to dedupe Sentry/OTel versions ([#80](https://github.com/ChurroStack/churro-coder/issues/80)) ([be8ddaf](https://github.com/ChurroStack/churro-coder/commit/be8ddafc4dc61fdf107cc0c3d6af84b3a258dd95))
* **desktop:** plan Approve button is a no-op in multi-pane and on mode-switch invalidation ([#154](https://github.com/ChurroStack/churro-coder/issues/154)) ([70b45e4](https://github.com/ChurroStack/churro-coder/commit/70b45e46b7f0ba571c80db5e81defa71067c1859))
* **desktop:** preserve manual model pick across mode switches ([#116](https://github.com/ChurroStack/churro-coder/issues/116)) ([f12ca21](https://github.com/ChurroStack/churro-coder/commit/f12ca21941d0a6d159e8de8f458917690228124c))
* **desktop:** prevent max-update-depth crash in AgentTaskToolsGroup ([#145](https://github.com/ChurroStack/churro-coder/issues/145)) ([843c59f](https://github.com/ChurroStack/churro-coder/commit/843c59f854ccd06c8447c45776f1b12ece6feb2b))
* **desktop:** recover from non-array projects.list responses ([#108](https://github.com/ChurroStack/churro-coder/issues/108)) ([ba4e47a](https://github.com/ChurroStack/churro-coder/commit/ba4e47ad0d53588c02454d01e52382be9fe8680c))
* **desktop:** recover from poisoned chats.get cache on cold launch ([#111](https://github.com/ChurroStack/churro-coder/issues/111)) ([0afcef3](https://github.com/ChurroStack/churro-coder/commit/0afcef3efda80adcfdc51753f4517c927a4ba40a))
* **desktop:** rename CLI subChat tab on first write_plan ([#163](https://github.com/ChurroStack/churro-coder/issues/163)) ([1c44938](https://github.com/ChurroStack/churro-coder/commit/1c44938b0ec3e5fdf3d4a0550b1a5a5000598eb3))
* **desktop:** repopulate Plan widget and CLI spinner for CLI sub-chats ([#161](https://github.com/ChurroStack/churro-coder/issues/161)) ([38e24a0](https://github.com/ChurroStack/churro-coder/commit/38e24a0662544173951764991c33387ee6daa9a5))
* **desktop:** resolve all TypeScript errors and make all tests pass ([#144](https://github.com/ChurroStack/churro-coder/issues/144)) ([308ac33](https://github.com/ChurroStack/churro-coder/commit/308ac332c45e1efd6da31541782b912d564788c3))
* **desktop:** show tool-call error reason in icon tooltip ([#109](https://github.com/ChurroStack/churro-coder/issues/109)) ([9307020](https://github.com/ChurroStack/churro-coder/commit/930702061a83aa3dfaf5fa060ebf9f7776d19633))
* **desktop:** show working spinner and auto-rename CLI subChat tabs ([#159](https://github.com/ChurroStack/churro-coder/issues/159)) ([c5952f2](https://github.com/ChurroStack/churro-coder/commit/c5952f274b2ee3f157d7b764e4bb6f34d915e43d))
* **desktop:** spinner wins over hand status while agent is working ([#174](https://github.com/ChurroStack/churro-coder/issues/174)) ([125ab14](https://github.com/ChurroStack/churro-coder/commit/125ab14778a3935d5ecd1a9977aedc70d7de9527))
* **desktop:** stop aborting Codex streams on workspace switch ([#78](https://github.com/ChurroStack/churro-coder/issues/78)) ([32764b3](https://github.com/ChurroStack/churro-coder/commit/32764b38a73c2550a2a6b4df2ca75eefc5e74578))
* **desktop:** stop file-viewer search-jump from snapping caret on each keystroke ([#160](https://github.com/ChurroStack/churro-coder/issues/160)) ([0c7bce8](https://github.com/ChurroStack/churro-coder/commit/0c7bce89484da7099ca369435b2ca4e5c9ebd5b5))
* **desktop:** stop tab-strip clipping, auto-promote active chat tabs ([#138](https://github.com/ChurroStack/churro-coder/issues/138)) ([d99424b](https://github.com/ChurroStack/churro-coder/commit/d99424b8d875ae21e6ba03c1b136b6d542ee9c26))
* **desktop:** unify sub-chat busy state — sidebar, dock tab, kanban ([#169](https://github.com/ChurroStack/churro-coder/issues/169)) ([fffa177](https://github.com/ChurroStack/churro-coder/commit/fffa17759b19abcb1df3eac978e984e0ad3321a6))
* **desktop:** Windows polish — installs, icons, dialog, CLI detection, .cmd shims ([#164](https://github.com/ChurroStack/churro-coder/issues/164)) ([c0e70ac](https://github.com/ChurroStack/churro-coder/commit/c0e70acb243c82256f62d8cb84bc8d3f66988ad2))
* guard pickProject against non-array projects value ([#98](https://github.com/ChurroStack/churro-coder/issues/98)) ([d1ec8a5](https://github.com/ChurroStack/churro-coder/commit/d1ec8a5b1f28d6257196b629bfc8de9deddb8ca9))
* improve workspace defaults and push feedback ([#25](https://github.com/ChurroStack/churro-coder/issues/25)) ([3c73132](https://github.com/ChurroStack/churro-coder/commit/3c73132139e9eabddef319ad54d85cb4e86c3f74))
* include expired questions in workspace indicators ([#27](https://github.com/ChurroStack/churro-coder/issues/27)) ([55438f5](https://github.com/ChurroStack/churro-coder/commit/55438f50981f2546a8b7d650dbe080e2164a3b85))
* make AI PR creation primary ([#29](https://github.com/ChurroStack/churro-coder/issues/29)) ([b6508c4](https://github.com/ChurroStack/churro-coder/commit/b6508c407f0bdb571109dd8f478fe83682543b19))
* make approved plan MCP retrieval reliable across providers ([#90](https://github.com/ChurroStack/churro-coder/issues/90)) ([38dd7cc](https://github.com/ChurroStack/churro-coder/commit/38dd7cc7139a6915020bd50b4be118169aade54c))
* move mode/model switch before await in handleApprovePlan + agent-mode tests ([#36](https://github.com/ChurroStack/churro-coder/issues/36)) ([6237fa9](https://github.com/ChurroStack/churro-coder/commit/6237fa936ae4cf872e2fc21ef40fe91c43a09494))
* plan-approval session reset, Claude OAuth auto-close, scripts in dockview ([#45](https://github.com/ChurroStack/churro-coder/issues/45)) ([3e6981a](https://github.com/ChurroStack/churro-coder/commit/3e6981a3697041c6afca34288ce89c043cbc5189))
* prevent duplicate message submissions with in-flight tracking ([#74](https://github.com/ChurroStack/churro-coder/issues/74)) ([f7dd78d](https://github.com/ChurroStack/churro-coder/commit/f7dd78d70a0b52b119ec65ff186a9acca434dbfc))
* prevent subagents/tool calls hanging in "Running" forever ([#12](https://github.com/ChurroStack/churro-coder/issues/12)) ([4fbff14](https://github.com/ChurroStack/churro-coder/commit/4fbff14c3b4e2932e5a1b8511f6934c8d0543926))
* prevent UI crash on Codex Edit tool + harden render-error auto-recovery ([#17](https://github.com/ChurroStack/churro-coder/issues/17)) ([78c7238](https://github.com/ChurroStack/churro-coder/commit/78c7238b917e45132f0be62406a5201a962ab8c2))
* prevent workspace switches from aborting in-flight streams ([#79](https://github.com/ChurroStack/churro-coder/issues/79)) ([e79dde9](https://github.com/ChurroStack/churro-coder/commit/e79dde9cff725e90af8873ba62c4116936266cc9))
* restore dockview overflow menu layering ([#23](https://github.com/ChurroStack/churro-coder/issues/23)) ([87891f1](https://github.com/ChurroStack/churro-coder/commit/87891f1bb29228af1e7f569f89114486daeceb9a))
* restore TodoWrite/Task progress display after plan approval ([#44](https://github.com/ChurroStack/churro-coder/issues/44)) ([5c8883d](https://github.com/ChurroStack/churro-coder/commit/5c8883da2573c549a434db5cf7ab66ac8947e1af))
* safely use origin/&lt;branch&gt; as worktree base when tracking and not a ([#75](https://github.com/ChurroStack/churro-coder/issues/75)) ([1369eb9](https://github.com/ChurroStack/churro-coder/commit/1369eb9024dc87ea24819e334429de9e4b9c9198))
* **sandbox:** allow CLIs to read their own plans, pasted text, and memory ([#57](https://github.com/ChurroStack/churro-coder/issues/57)) ([5920249](https://github.com/ChurroStack/churro-coder/commit/5920249fb1b0cb7bcf7a3f718b8881af8b0b325d))
* Send sourcemap to sentry ([#83](https://github.com/ChurroStack/churro-coder/issues/83)) ([c0d0905](https://github.com/ChurroStack/churro-coder/commit/c0d090543e9d844d21567b076d35c5496b6929f3))
* show codex recap usage ([#26](https://github.com/ChurroStack/churro-coder/issues/26)) ([6f8601d](https://github.com/ChurroStack/churro-coder/commit/6f8601d243debd804d2746ba9adac52e49a7b175))
* show file viewer header in non-dockview surfaces ([#4](https://github.com/ChurroStack/churro-coder/issues/4)) ([6996df6](https://github.com/ChurroStack/churro-coder/commit/6996df6d8fc516135ab3091ac25684f364e74355))
* silently recover from SESSION_EXPIRED so chat doesn't appear empty ([#7](https://github.com/ChurroStack/churro-coder/issues/7)) ([6b3c06a](https://github.com/ChurroStack/churro-coder/commit/6b3c06a3ab0a1022e67e394962464cb211351ab1))
* **status-widget:** full green after PR created, idle for blank chats, code done after commits pushed ([#58](https://github.com/ChurroStack/churro-coder/issues/58)) ([ba5c20f](https://github.com/ChurroStack/churro-coder/commit/ba5c20fe1a132fed94f763d46c5d0d28b9fdd4c1))
* strip mention tokens from chat titles ([#71](https://github.com/ChurroStack/churro-coder/issues/71)) ([f2af39e](https://github.com/ChurroStack/churro-coder/commit/f2af39ed8fbd6c8a9020098f2d25eb13fb48be9d))
* terminal and split panels now land at the correct position in Smart mode ([#41](https://github.com/ChurroStack/churro-coder/issues/41)) ([05d5b2d](https://github.com/ChurroStack/churro-coder/commit/05d5b2d8e2b6d32abfc8394087cbb26d77b15c4a))
* update agents-archive-popover.tsx ([#53](https://github.com/ChurroStack/churro-coder/issues/53)) ([bb24284](https://github.com/ChurroStack/churro-coder/commit/bb242844350bc5ed3799bcd2215c70f3e6bae410))
* update continue-button.tsx ([#24](https://github.com/ChurroStack/churro-coder/issues/24)) ([9dbd27e](https://github.com/ChurroStack/churro-coder/commit/9dbd27e6ca8436ea61598a634f12265b2368c5f1))
* update index.ts, active-chat.tsx ([#51](https://github.com/ChurroStack/churro-coder/issues/51)) ([edd0764](https://github.com/ChurroStack/churro-coder/commit/edd0764ef371609b5302beb00b4471a1464688da))
* update new-chat-form.tsx ([#35](https://github.com/ChurroStack/churro-coder/issues/35)) ([80bb32f](https://github.com/ChurroStack/churro-coder/commit/80bb32f044675bdd5a56454a5dca76422beb0bae))
* update package.json, shell-env.ts, policy.ts ([#48](https://github.com/ChurroStack/churro-coder/issues/48)) ([9f57eaf](https://github.com/ChurroStack/churro-coder/commit/9f57eafb3234482587fe086b042d97b9b4c4ab3c))
* update policy.ts ([#28](https://github.com/ChurroStack/churro-coder/issues/28)) ([8335b38](https://github.com/ChurroStack/churro-coder/commit/8335b3844aa8138a438df3928d7fa940f619307b))
* use git show for commit diffs to handle root commits and merges ([#67](https://github.com/ChurroStack/churro-coder/issues/67)) ([08e7cfb](https://github.com/ChurroStack/churro-coder/commit/08e7cfbbb407306ff3c1a8a215c632129e83ed9c))


### Continuous Integration

* **desktop:** add release-please + GitHub Actions installer pipeline ([#176](https://github.com/ChurroStack/churro-coder/issues/176)) ([aa638b1](https://github.com/ChurroStack/churro-coder/commit/aa638b15749901a284c19baba56a5a7444da1a16))

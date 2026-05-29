# Changelog

## [1.9.0](https://github.com/scudera/career-ops/compare/career-ops-v1.8.0...career-ops-v1.9.0) (2026-05-29)


### Features

* add structured machine summaries to evaluations ([#444](https://github.com/scudera/career-ops/issues/444)) ([19a1820](https://github.com/scudera/career-ops/commit/19a1820f99e05db68508a2b769379384636a9e83))
* add Ukrainian language and market support ([#323](https://github.com/scudera/career-ops/issues/323)) ([06d70d3](https://github.com/scudera/career-ops/commit/06d70d30b26754228e7560e6477f94e8d5360874))
* **apply:** add Step 0 mandatory liveness check in English ([ad3d045](https://github.com/scudera/career-ops/commit/ad3d045451dc1b142b59092f4e38dc0b91a03e28))
* **auto-cron:** daily scan + Notion Vagas Tracker sync ([1784781](https://github.com/scudera/career-ops/commit/17847818c82ad1c6f858d64a80e05bd8689613d4))
* **batch:** add --model flag to batch-runner.sh ([#504](https://github.com/scudera/career-ops/issues/504)) ([44def35](https://github.com/scudera/career-ops/commit/44def35c23c43e91d9633951d90f4ff50773c931))
* **ci:** add PharmiWeb RSS + 5 Indeed BR entries to portals.ci.yml ([4322887](https://github.com/scudera/career-ops/commit/43228872b51f6ffa977daf763813bb9ef07ae316))
* **classify:** [@graph](https://github.com/graph) recursion for JSON-LD JobPosting discovery (COTSK-9 Trick 2) ([5a6b771](https://github.com/scudera/career-ops/commit/5a6b771109bf6eb30deceffbc69d7a53bddf0608))
* **classify:** HTML comment stripping in JSON-LD extraction (COTSK-9 Trick 1) ([5586b74](https://github.com/scudera/career-ops/commit/5586b7469be63eb7a50ea878e94a9118709027f6))
* **classify:** lenient JSON parse fallback for legacy site formats (COTSK-9 Trick 3) ([b370184](https://github.com/scudera/career-ops/commit/b370184cd048541a75f756159c3c5254f860983f))
* consensus voting for non-deterministic SPA classification (CP3.5 Fase A) ([24fac79](https://github.com/scudera/career-ops/commit/24fac79934c85c4676256bca6215dbd55178ef93))
* **cp4-fase-a:** partial Workday scan discovery (5 tenants, 18 RA-relevant new entries) ([364b060](https://github.com/scudera/career-ops/commit/364b0605f8c038e84d23823754e390eed7dd814d))
* **dashboard:** /-key live search across pipeline rows ([#526](https://github.com/scudera/career-ops/issues/526)) ([433f34f](https://github.com/scudera/career-ops/commit/433f34f20aec61c68fda5dd9274a06919d0d7fc2))
* **dash:** wire pre-existing Go TUI dashboard via npm scripts ([28aff67](https://github.com/scudera/career-ops/commit/28aff677df8637952142f8f72fca583ef128ba00))
* dynamic DOM-stable wait (Risk [#2](https://github.com/scudera/career-ops/issues/2) = C, resolve flaky hydration) ([4e4a50f](https://github.com/scudera/career-ops/commit/4e4a50fdda7e13c6094232d6404bd1466e3ba27c))
* **gupy:** API primary + NEXT_DATA fallback (COTSK-8 Fase B) ([c2445a6](https://github.com/scudera/career-ops/commit/c2445a6724e6e6314bd162ab44f75c1e25da91d4))
* **i18n:** add Turkish (TR) language modes ([#341](https://github.com/scudera/career-ops/issues/341)) ([e87eb57](https://github.com/scudera/career-ops/commit/e87eb576df3aa394a7e28acd9f04a805ca0ca696))
* **interview-prep:** backfill story-bank from 37 STAR-format reports (COHO-28) ([56ec627](https://github.com/scudera/career-ops/commit/56ec627aa3ab539cedf313dd5847a4adb241df80))
* **interview-prep:** split prep by interviewer audience ([#489](https://github.com/scudera/career-ops/issues/489)) ([d86b86c](https://github.com/scudera/career-ops/commit/d86b86c93ada6cd8d74213357a1566f17dccd280))
* label drift validation report (top 30 entries, read-only) ([e906ffe](https://github.com/scudera/career-ops/commit/e906ffea82924fbb8c03e275863137f56fef81ef))
* **liveness:** add pre-apply-check.mjs + gitignore generic backups ([4f0754d](https://github.com/scudera/career-ops/commit/4f0754d2df9201d4da8bddf4a9bf9075543011f2))
* next-action workflow + Indeed BR provider + tier populate tool ([a409700](https://github.com/scudera/career-ops/commit/a40970061cf6471127257a022d56a8bb4c0dcd99))
* **notion:** sync eval Priority Score to Notion entries ([d05446a](https://github.com/scudera/career-ops/commit/d05446a276b9d10670e08862ac5e6c3516473e76))
* phenom nav-menu strip — defensive fallback for body-text BR false positives ([64019a6](https://github.com/scudera/career-ops/commit/64019a6b4403e34f81085d0f32f445ca4a724f01))
* **phenom:** scan-time JSON-LD enrich opt-in (COTSK-11 Sub-track A) ([07471f3](https://github.com/scudera/career-ops/commit/07471f39132ba49c1fb5db221e8f12bb253e5f19))
* **pipeline:** serialize v2.1 fields in scan.mjs + parse parts[4] in filter-candidates ([68337f2](https://github.com/scudera/career-ops/commit/68337f27179cea5483fd938387987a27b95b8291))
* pre-apply enrich UNKNOWN entries via inspect-jds (post title-filter) ([1f34244](https://github.com/scudera/career-ops/commit/1f3424436c10c2bb52288d5f8312591c1206a546))
* **providers:** add Gupy BR provider (Next.js __NEXT_DATA__ SSR) ([1e2bd90](https://github.com/scudera/career-ops/commit/1e2bd90c5331e11dbbde8ce41e6b93e44e82d5b2))
* **providers:** add Phenom ATS provider (sitemap-based) ([1deff55](https://github.com/scudera/career-ops/commit/1deff55f4f5d51afdc5f02a1d2d0f7986399fc20))
* **providers:** add SmartRecruiters provider ([c3aa29e](https://github.com/scudera/career-ops/commit/c3aa29e4ad3a66de461a57edd091c07d480bb48a))
* **providers:** add Workable provider + verifySlug helper ([bf31432](https://github.com/scudera/career-ops/commit/bf31432e4c7f290687b41e6949f1ac4490d4237a))
* **providers:** add Workday provider following upstream contract ([acbf156](https://github.com/scudera/career-ops/commit/acbf156b10090bea3f1352415d3e64ff0e8a1213))
* **providers:** linkedin provider for job scanner ([a624cda](https://github.com/scudera/career-ops/commit/a624cda291d2c35a232e6820ed89eb31193ef2f8))
* **providers:** populate v2.1 fields in 5 providers (workday/gupy/workable/phenom/smartrec) ([a99fa0d](https://github.com/scudera/career-ops/commit/a99fa0df1a81e24c0fe6bfb4e89e6a6d561c343c))
* **rss:** RSS 2.0 + Atom 1.0 provider via fast-xml-parser (COTSK-10 Fase A) ([b3a9660](https://github.com/scudera/career-ops/commit/b3a96608e37a27446af1ebf7859dec8dcabbf7ef))
* **scan:** add --verify flag to drop expired postings before pipeline append ([#487](https://github.com/scudera/career-ops/issues/487)) ([82f0c2e](https://github.com/scudera/career-ops/commit/82f0c2ef9ee2155cf70300c2f64e15eeaf40a69e))
* **scan:** add HEAD-check step using validate-pipeline.mjs ([48aa228](https://github.com/scudera/career-ops/commit/48aa2286c3b86faa5ab857381501c02cdd0cce8e))
* **scan:** add local-parser provider and agent skip rules ([#595](https://github.com/scudera/career-ops/issues/595)) ([b3ef0ae](https://github.com/scudera/career-ops/commit/b3ef0ae3d7ca9ebffc1d8a524408c5dfa42e3446))
* **scan:** add optional always_allow tier to location_filter ([#652](https://github.com/scudera/career-ops/issues/652)) ([d152da3](https://github.com/scudera/career-ops/commit/d152da36e7625c229d15f6f2ef92ab43d4398cc8)), closes [#650](https://github.com/scudera/career-ops/issues/650)
* **scan:** add validate-pipeline.mjs for HEAD-check of pipeline URLs ([9280da1](https://github.com/scudera/career-ops/commit/9280da128453eb13f14c11632d98cc4af38d07be))
* **schema:** expand Job contract with employment_type/compensation/posted_at/apply_url (v2.1) ([4235157](https://github.com/scudera/career-ops/commit/42351579f9f2e976a2e2c338b9224705d2d1b92e))
* **schema:** v2.1 Job typedef + docs/pipeline-schema-v2.1.md content ([ca7efad](https://github.com/scudera/career-ops/commit/ca7efad52a675348f09942f7c0f5fa7cd544de26))
* Workday slug registry + master-profile pattern + CDP apply automation (auto-submit default) ([68e001d](https://github.com/scudera/career-ops/commit/68e001d0bfdf1a4eec74811b53341425d293742f))


### Bug Fixes

* **apply,security:** gate auto-submit behind --auto-submit flag (COHO-38 WI-1) ([#4](https://github.com/scudera/career-ops/issues/4)) ([819daaa](https://github.com/scudera/career-ops/commit/819daaa268d7016c7a6c241b418ed84c76bfa4f6))
* **batch,next-action:** MINGW compatibility + race-condition resilience ([0d68362](https://github.com/scudera/career-ops/commit/0d68362e0f3dba88d7bfca7bd62fa3dbf093c339))
* **ci:** remove cache: npm from setup-node (no lock file in repo) ([a3ae5c0](https://github.com/scudera/career-ops/commit/a3ae5c099c71fa8c191ca42c3d67d8a64fa57dfd))
* **ci:** setup Go before codeql-action/init to enable proper tracing ([9752782](https://github.com/scudera/career-ops/commit/97527828c74c438b93ee03ae55ecba75b0f93a1f))
* **cron:** remove eval-sync step from CI workflow (User Layer constraint) ([2b8ce3b](https://github.com/scudera/career-ops/commit/2b8ce3b64e4f3099a4b8599cbc01906783a6b6e7))
* **dashboard:** width-aware Markdown rendering with table wrapping in viewer ([#513](https://github.com/scudera/career-ops/issues/513)) ([dc3a247](https://github.com/scudera/career-ops/commit/dc3a247733d9fb7eb7159836bed743a587231192))
* **liveness:** add PT-BR 'candidatar' / 'candidatura' to APPLY_PATTERNS ([0949970](https://github.com/scudera/career-ops/commit/09499705b71f62142c04509834e59cc80ed1a294))
* **notion:** score parser fallback for older reports + fail-loud on sync errors ([1801f54](https://github.com/scudera/career-ops/commit/1801f54caab27fbd0514b9974f905f6f5898a479))
* **release:** sync VERSION file to 1.8.0 ([541917f](https://github.com/scudera/career-ops/commit/541917f627f3f328e5411a54685f5e8706761499))
* **scan,providers:** plug data-quality gaps in pipeline → Notion sync ([80022e3](https://github.com/scudera/career-ops/commit/80022e35723962cd0675796f8171e2a3a124a721))
* **scan:** bootstrap providers/ on update + harden greenhouse detect() ([#696](https://github.com/scudera/career-ops/issues/696)) ([4b12081](https://github.com/scudera/career-ops/commit/4b120817fc1a07d4664ff764bf2a1c51e443b524))
* **security:** allow multi-line HTML comments in pipeline regex ([fc9a0ef](https://github.com/scudera/career-ops/commit/fc9a0ef5f4b618917701af56ba0892972440f03c))
* **security:** escape backslashes before pipes in markdown table cells ([cdcf8f2](https://github.com/scudera/career-ops/commit/cdcf8f2e930882afad4445be4f407759f5a9da76))
* **update-system:** apply() safety violation reverts cleanly and releases lock ([#484](https://github.com/scudera/career-ops/issues/484)) ([980153c](https://github.com/scudera/career-ops/commit/980153c315ec3fbbe6f9195c77d2f865b5a2e1a0))
* **update-system:** bootstrap liveness-browser.mjs for v1.7→v1.8 upgrades ([#725](https://github.com/scudera/career-ops/issues/725)) ([1ea95f2](https://github.com/scudera/career-ops/commit/1ea95f293e742945fb4ba9befee4db8c50df6d2f)), closes [#704](https://github.com/scudera/career-ops/issues/704)
* **update-system:** rollback() removes paths absent from backup branch ([#483](https://github.com/scudera/career-ops/issues/483)) ([f94a3be](https://github.com/scudera/career-ops/commit/f94a3be25890d83ee2664175bbe1bebf1f3eb033))
* **workday:** subdivision algorithm bypasses 2K-cap silent truncation (port jobhive) ([eae0b79](https://github.com/scudera/career-ops/commit/eae0b790dc19bd3c258bb9830417fde5eee0b006))
* **workers:** pin model claude-sonnet-4-6 in batch-runner.sh (COHO-30 Branch A) ([ba3e2d7](https://github.com/scudera/career-ops/commit/ba3e2d716b5f12bb2ffc29cadba5963d9e2b558c))

## [1.8.0](https://github.com/santifer/career-ops/compare/career-ops-v1.7.1...career-ops-v1.8.0) (2026-05-15)


### Features

* **scan:** optional location_filter in portals.yml + persist location to scan-history ([#570](https://github.com/santifer/career-ops/issues/570)) ([d692647](https://github.com/santifer/career-ops/commit/d692647c253a0bf92a4f9f3b8043afe2c8161853))


### Bug Fixes

* **batch:** workers read modes/_profile.md and config/profile.yml ([#537](https://github.com/santifer/career-ops/issues/537)) ([150e223](https://github.com/santifer/career-ops/commit/150e223ba679246a378e7815da95b6b6d1c5e6ad)), closes [#534](https://github.com/santifer/career-ops/issues/534)
* **deps:** update dotenv to v17 ([#499](https://github.com/santifer/career-ops/issues/499)) ([ce1330e](https://github.com/santifer/career-ops/commit/ce1330efc45e9da462e81ccce3d5f27db9f8a623))
* **gemini-eval:** include profile.yml and _profile.md in evaluation ([#618](https://github.com/santifer/career-ops/issues/618)) ([73dc603](https://github.com/santifer/career-ops/commit/73dc6038d2e723997426d73d3a0c5040c48dd033)), closes [#617](https://github.com/santifer/career-ops/issues/617)
* **gemini-eval:** redact API key from error logs, harden summary parsing ([#582](https://github.com/santifer/career-ops/issues/582)) ([fdca4de](https://github.com/santifer/career-ops/commit/fdca4ded87e1dbde0571fe740da061da491f46c7))
* **gemini-eval:** switch default model to non-deprecated endpoint, surface 429 guidance ([#615](https://github.com/santifer/career-ops/issues/615)) ([dd3e036](https://github.com/santifer/career-ops/commit/dd3e0366d26719af7be234786a16512f46ac9e85)), closes [#614](https://github.com/santifer/career-ops/issues/614)
* **manifest:** align plugin.json skills field with Claude Code plugin schema ([#612](https://github.com/santifer/career-ops/issues/612)) ([a77d3f6](https://github.com/santifer/career-ops/commit/a77d3f6aa3f5c278665c95c5a12048e4df66d337))
* **merge-tracker:** preserve short specialty acronyms, require non-baseline overlap ([#634](https://github.com/santifer/career-ops/issues/634)) ([5ed3b3d](https://github.com/santifer/career-ops/commit/5ed3b3d7ea693547153ef734ab5f6016414c3301)), closes [#633](https://github.com/santifer/career-ops/issues/633)
* **modes:** make /career-ops deep respect user language, not JD language ([#568](https://github.com/santifer/career-ops/issues/568)) ([e5f0508](https://github.com/santifer/career-ops/commit/e5f0508b94299a0e6b46918ecca2f483de0a58c6))
* **portals:** update Weights & Biases entry to CoreWeave acquisition ([#493](https://github.com/santifer/career-ops/issues/493)) ([1411cdc](https://github.com/santifer/career-ops/commit/1411cdc461de05a6772c854188053bcaeeb4ee32))
* **release:** sync VERSION file to 1.7.1 ([2ebfcab](https://github.com/santifer/career-ops/commit/2ebfcabdb4cf7973e279e56f8eae001a8dadc5ed))
* **scan:** validate Greenhouse URL hostname against allowlist to prevent SSRF ([#602](https://github.com/santifer/career-ops/issues/602)) ([988f7bb](https://github.com/santifer/career-ops/commit/988f7bb2a642f91d6cce1e2fc94f08658b72e099))
* **templates:** align CV certification rows on a 3-column grid ([#638](https://github.com/santifer/career-ops/issues/638)) ([082cd11](https://github.com/santifer/career-ops/commit/082cd11c32b917fe3aeef709ff4f386371af3e64))
* **update-system:** allow writing-samples/README.md as system-owned file ([#562](https://github.com/santifer/career-ops/issues/562)) ([207fd07](https://github.com/santifer/career-ops/commit/207fd076da3b2a30f0384fdb19312078ebdcf71f))
* **update-system:** bootstrap .agents/ for v1.6→v1.7 migration ([#654](https://github.com/santifer/career-ops/issues/654)) ([4714504](https://github.com/santifer/career-ops/commit/47145048716d3716a2f1cb0b46377a88e5df73c0))
* **update-system:** defensive VERSION parsing for release-please marker ([#547](https://github.com/santifer/career-ops/issues/547)) ([bf84886](https://github.com/santifer/career-ops/commit/bf848860cb2c7976f6e77e1b5d7b60ed5e9d0d14))

## [1.7.1](https://github.com/santifer/career-ops/compare/career-ops-v1.7.0...career-ops-v1.7.1) (2026-05-12)


### Bug Fixes

* **release:** sync VERSION file to 1.7.0 ([8e554cc](https://github.com/santifer/career-ops/commit/8e554cc4437c3a58e813378abb9b35e2e08a007e))
* **update-system:** include .agents/ in SYSTEM_PATHS ([#600](https://github.com/santifer/career-ops/issues/600)) ([3a71469](https://github.com/santifer/career-ops/commit/3a714695c63ca01a6581b4307885be2055319784))

## [1.7.0](https://github.com/santifer/career-ops/compare/career-ops-v1.6.0...career-ops-v1.7.0) (2026-05-06)


### Features

* adapt contacto mode by contact type (recruiter/HM/peer/interviewer) ([9fd5a90](https://github.com/santifer/career-ops/commit/9fd5a90896f20020f48455cd079b64fed491b89f))
* add --min-score flag to batch runner ([#249](https://github.com/santifer/career-ops/issues/249)) ([cb0c7f7](https://github.com/santifer/career-ops/commit/cb0c7f7d7d3b9f3f1c3dc75ccac0a08d2737c01e))
* add {{PHONE}} placeholder to CV template ([#287](https://github.com/santifer/career-ops/issues/287)) ([e71595f](https://github.com/santifer/career-ops/commit/e71595f8ba134971ecf1cc3c3420d9caf21eed43))
* add Block G — posting legitimacy assessment ([3a636ac](https://github.com/santifer/career-ops/commit/3a636ac586659bb798ef46a0a9798478a1e28b0a))
* add Claude Code plugin manifests (path-stable) ([62b767d](https://github.com/santifer/career-ops/commit/62b767dcc56e4c875ed70bf4fe799c254ecf8eea))
* add follow-up cadence tracker mode ([4308c37](https://github.com/santifer/career-ops/commit/4308c375033c6df430308235f4324658a8353b81))
* add Gemini CLI native integration and evaluator script  ([#349](https://github.com/santifer/career-ops/issues/349)) ([0853486](https://github.com/santifer/career-ops/commit/0853486d2c01a35adafea2cc6b6d8c429b843588))
* add Gemini CLI native integration and evaluator script (closes [#344](https://github.com/santifer/career-ops/issues/344)) ([0853486](https://github.com/santifer/career-ops/commit/0853486d2c01a35adafea2cc6b6d8c429b843588))
* add GitHub Actions CI + auto-labeler + welcome bot + /run skill ([2ddf22a](https://github.com/santifer/career-ops/commit/2ddf22a6a2731b38bcaed5786c4855c4ab9fe722))
* add LaTeX/Overleaf CV export mode with pdflatex compilation ([#362](https://github.com/santifer/career-ops/issues/362)) ([b824953](https://github.com/santifer/career-ops/commit/b824953d0e3b7f8c6105dfcce7e17257c95ce6cd))
* add LaTeX/Overleaf CV export mode with pdflatex compilation (closes [#47](https://github.com/santifer/career-ops/issues/47)) ([b824953](https://github.com/santifer/career-ops/commit/b824953d0e3b7f8c6105dfcce7e17257c95ce6cd))
* add Nix flake devshell with Playwright support ([c579fcd](https://github.com/santifer/career-ops/commit/c579fcddebf793f00cfad8534fd74085c09017fb))
* add OpenCode slash commands for career-ops ([#67](https://github.com/santifer/career-ops/issues/67)) ([93caaed](https://github.com/santifer/career-ops/commit/93caaed49cbc9f3214f9beb66fb2281c3f2370e6))
* add scan.mjs — zero-token portal scanner ([8c19b2b](https://github.com/santifer/career-ops/commit/8c19b2b59f7087689e004f3d48e912f291911373))
* add writing-samples folder for AI-detection-evading voice calibration ([9ae201d](https://github.com/santifer/career-ops/commit/9ae201d0682a17e7006ed7902b42db8234212e97))
* **cv:** add cv.output_format to route between html and latex generation ([b82bb5f](https://github.com/santifer/career-ops/commit/b82bb5fb7c86ab3074a54eaf0f3186f81d41f417))
* **dashboard:** add Catppuccin Latte light theme with auto-detection ([ff686c8](https://github.com/santifer/career-ops/commit/ff686c8af97a7bf93565fe8eeac677f998cc9ece))
* **dashboard:** add manual refresh shortcut ([#246](https://github.com/santifer/career-ops/issues/246)) ([4b5093a](https://github.com/santifer/career-ops/commit/4b5093a8ef1733c449ec0821f722f996625fcb84))
* **dashboard:** add progress analytics screen ([623c837](https://github.com/santifer/career-ops/commit/623c837bf3155fd5b7413554240071d40585dd7e))
* **dashboard:** add rejected and discarded pipeline tabs ([7d05967](https://github.com/santifer/career-ops/commit/7d05967389fb6185f0d6e566a4ba583ee3824e1e))
* **dashboard:** add vim motions to pipeline screen ([#262](https://github.com/santifer/career-ops/issues/262)) ([d149e54](https://github.com/santifer/career-ops/commit/d149e541402db0c88161a71c73899cd1836a1b2d))
* **dashboard:** aligned tables and markdown syntax rendering in viewer ([dbd1d3f](https://github.com/santifer/career-ops/commit/dbd1d3f7177358d0384d6e661d1b0dfc1f60bd4e))
* **dashboard:** show tracker IDs in pipeline list ([8d289c6](https://github.com/santifer/career-ops/commit/8d289c64e31f81cf447f75105b500d1feca21058))
* expand portals.example.yml with 8 dev-tools companies + 23 search queries ([#140](https://github.com/santifer/career-ops/issues/140)) ([b7f555d](https://github.com/santifer/career-ops/commit/b7f555d7b9a7b23c875fa0d35584df534961dabe))
* **i18n:** add Japanese README + language modes for Japan market ([20a2c81](https://github.com/santifer/career-ops/commit/20a2c817486968ca42a534aa86838c797d599c10))
* **latex:** add tectonic engine auto-detect with pdflatex fallback ([4b71b2c](https://github.com/santifer/career-ops/commit/4b71b2cbf4fd49d3882cdd8767e31727337fab34))
* multi-CLI support via open agent skill standard ([#572](https://github.com/santifer/career-ops/issues/572)) ([7605a5e](https://github.com/santifer/career-ops/commit/7605a5ed68d0fd559374afec1cd8798c487e3ead))
* **portals:** add Canada/Vancouver and automation companies to example template ([590ba6e](https://github.com/santifer/career-ops/commit/590ba6e1b4b9d2d9d03893b7f5fdae920d4f9a0b))


### Bug Fixes

* 10 bug fixes — resource leaks, command injection, Unicode, navigation ([cb01a2c](https://github.com/santifer/career-ops/commit/cb01a2c2e3b7fc334b1c4594749ea40b0da8fc62))
* add data/ fallback to UpdateApplicationStatus ([#55](https://github.com/santifer/career-ops/issues/55)) ([3512b8e](https://github.com/santifer/career-ops/commit/3512b8ef4eb8ca967bc967664f8798af42b58a52))
* add stopword filtering and overlap ratio to roleMatch ([#248](https://github.com/santifer/career-ops/issues/248)) ([4da772d](https://github.com/santifer/career-ops/commit/4da772d3a4996bc9ecbe2d384d1e9d2ed75b9819))
* align portals.example.yml indentation for new companies ([26a6751](https://github.com/santifer/career-ops/commit/26a675173e64dac09fd1524ff9a7c7061520e057))
* **ci:** correct first-interaction@v3 input names ([c5196a8](https://github.com/santifer/career-ops/commit/c5196a8dd8ff05da51c72ea151f67e481f12c329))
* **ci:** gracefully handle missing dependency graph in dependency-review ([#343](https://github.com/santifer/career-ops/issues/343)) ([7c5fecb](https://github.com/santifer/career-ops/commit/7c5fecb00d60521f77b33724eb345a28257d8832))
* **ci:** gracefully handle missing dependency graph in dependency-review workflow ([#352](https://github.com/santifer/career-ops/issues/352)) ([7c5fecb](https://github.com/santifer/career-ops/commit/7c5fecb00d60521f77b33724eb345a28257d8832))
* **ci:** use pull_request_target for labeler on fork PRs ([#260](https://github.com/santifer/career-ops/issues/260)) ([2ecf572](https://github.com/santifer/career-ops/commit/2ecf57206c2eb6e35e2a843d6b8365f7a04c53d6))
* correct _shared.md → _profile.md reference in CUSTOMIZATION.md (closes [#137](https://github.com/santifer/career-ops/issues/137)) ([a91e264](https://github.com/santifer/career-ops/commit/a91e264b6ea047a76d8c033aa564fe01b8f9c1d9))
* correct dashboard launch path in docs ([#80](https://github.com/santifer/career-ops/issues/80)) ([2b969ee](https://github.com/santifer/career-ops/commit/2b969eea5f6bbc8f29b9e42bedb59312379e9f02))
* **dashboard:** show dates in pipeline list ([#298](https://github.com/santifer/career-ops/issues/298)) ([e5e2a6c](https://github.com/santifer/career-ops/commit/e5e2a6cffe9a5b9f3cec862df25410d02ecc9aa4))
* ensure data/ and output/ dirs exist before writing in scripts ([#261](https://github.com/santifer/career-ops/issues/261)) ([4b834f6](https://github.com/santifer/career-ops/commit/4b834f6f7f8f1b647a6bf76e43b017dcbe9cd52f))
* filter expired WebSearch links before they reach the pipeline ([#57](https://github.com/santifer/career-ops/issues/57)) ([ce1c5a3](https://github.com/santifer/career-ops/commit/ce1c5a3c7eea6ebce2c90aebba59d6e26b790d3f))
* improve default PDF readability ([#85](https://github.com/santifer/career-ops/issues/85)) ([10034ec](https://github.com/santifer/career-ops/commit/10034ec3304c1c79ff9c9678c7826ab77c0bcbf7))
* liveness checks ignore nav/footer Apply text, expired signals win ([3a3cb95](https://github.com/santifer/career-ops/commit/3a3cb95bdf09235509df72e30b3077623f571ea1))
* **liveness:** detect closed postings with applications-closed banner variants ([7f8217e](https://github.com/santifer/career-ops/commit/7f8217e057b327980a797a682c4f01d3318edbbe))
* **merge-tracker:** filter seniority and location stopwords + require overlap ratio in roleFuzzyMatch ([7821113](https://github.com/santifer/career-ops/commit/7821113261eeb32f99639ff076651ab2e7757209))
* **pt:** restore diacritical marks in PT-BR modes ([#358](https://github.com/santifer/career-ops/issues/358)) ([3a4c596](https://github.com/santifer/career-ops/commit/3a4c596cb0a522f562ba38b35c210facaf38a503))
* **pt:** restore diacritical marks in PT-BR modes ([#359](https://github.com/santifer/career-ops/issues/359)) ([3a4c596](https://github.com/santifer/career-ops/commit/3a4c596cb0a522f562ba38b35c210facaf38a503))
* **release:** sync VERSION and package.json via release-please-config ([6a3dc22](https://github.com/santifer/career-ops/commit/6a3dc224337a1942bf2ebf18b9b275d94fc06e7a))
* remove wellfound, lever and remotefront from portals.example.yml ([#286](https://github.com/santifer/career-ops/issues/286)) ([ecd013c](https://github.com/santifer/career-ops/commit/ecd013cc6f59e3a1a8ef77d34e7abc15e8075ed3))
* replace grep -P with POSIX-compatible grep in batch-runner.sh ([637b39e](https://github.com/santifer/career-ops/commit/637b39e383d1174c8287f42e9534e9e3cdfabb19))
* test-all.mjs scans only git-tracked files, avoids false positives ([47c9f98](https://github.com/santifer/career-ops/commit/47c9f984d8ddc70974f15c99b081667b73f1bb9a))
* **update-system:** cross-check GitHub Releases API when VERSION file is stale ([b0ee6eb](https://github.com/santifer/career-ops/commit/b0ee6ebfcec7920ea7590ada61f3c39324d22ebc))
* **update-system:** expand SYSTEM_PATHS to cover all language modes and current scripts ([34fe3fb](https://github.com/santifer/career-ops/commit/34fe3fbd5782f7f57faf8ef4a245fbee6275a040))
* use candidate name from profile.yml in PDF filename ([7bcbc08](https://github.com/santifer/career-ops/commit/7bcbc08ca6184362398690234e49df0ac157567f))
* use execFileSync to prevent shell injection in test-all.mjs ([c99d5a6](https://github.com/santifer/career-ops/commit/c99d5a6526f923b56c3790b79b0349f402fa00e2))
* use fileURLToPath for cross platform compatible paths in tracker scripts ([#32](https://github.com/santifer/career-ops/issues/32)) ([#58](https://github.com/santifer/career-ops/issues/58)) ([ab77510](https://github.com/santifer/career-ops/commit/ab775102f4586ae4663a593b519927531be27122))
* use hi@santifer.io in English README ([5518d3d](https://github.com/santifer/career-ops/commit/5518d3dd07716137b97bb4d8c7b5264b94e2b9e9))


### Performance Improvements

* compress hero banner from 5.7MB to 671KB ([dac4259](https://github.com/santifer/career-ops/commit/dac425913620fe0a66916dda7ba8d8fc4c427d51))

## [1.6.0](https://github.com/santifer/career-ops/compare/v1.5.0...v1.6.0) (2026-04-26)


### Features

* add Gemini CLI native integration and evaluator script  ([#349](https://github.com/santifer/career-ops/issues/349)) ([0853486](https://github.com/santifer/career-ops/commit/0853486d2c01a35adafea2cc6b6d8c429b843588))
* add Gemini CLI native integration and evaluator script (closes [#344](https://github.com/santifer/career-ops/issues/344)) ([0853486](https://github.com/santifer/career-ops/commit/0853486d2c01a35adafea2cc6b6d8c429b843588))
* add LaTeX/Overleaf CV export mode with pdflatex compilation ([#362](https://github.com/santifer/career-ops/issues/362)) ([b824953](https://github.com/santifer/career-ops/commit/b824953d0e3b7f8c6105dfcce7e17257c95ce6cd))
* add LaTeX/Overleaf CV export mode with pdflatex compilation (closes [#47](https://github.com/santifer/career-ops/issues/47)) ([b824953](https://github.com/santifer/career-ops/commit/b824953d0e3b7f8c6105dfcce7e17257c95ce6cd))
* **cv:** add cv.output_format to route between html and latex generation ([b82bb5f](https://github.com/santifer/career-ops/commit/b82bb5fb7c86ab3074a54eaf0f3186f81d41f417))
* **dashboard:** add rejected and discarded pipeline tabs ([7d05967](https://github.com/santifer/career-ops/commit/7d05967389fb6185f0d6e566a4ba583ee3824e1e))
* **dashboard:** show tracker IDs in pipeline list ([8d289c6](https://github.com/santifer/career-ops/commit/8d289c64e31f81cf447f75105b500d1feca21058))
* **latex:** add tectonic engine auto-detect with pdflatex fallback ([4b71b2c](https://github.com/santifer/career-ops/commit/4b71b2cbf4fd49d3882cdd8767e31727337fab34))
* **portals:** add Canada/Vancouver and automation companies to example template ([590ba6e](https://github.com/santifer/career-ops/commit/590ba6e1b4b9d2d9d03893b7f5fdae920d4f9a0b))


### Bug Fixes

* **ci:** correct first-interaction@v3 input names ([c5196a8](https://github.com/santifer/career-ops/commit/c5196a8dd8ff05da51c72ea151f67e481f12c329))
* **ci:** gracefully handle missing dependency graph in dependency-review ([#343](https://github.com/santifer/career-ops/issues/343)) ([7c5fecb](https://github.com/santifer/career-ops/commit/7c5fecb00d60521f77b33724eb345a28257d8832))
* **ci:** gracefully handle missing dependency graph in dependency-review workflow ([#352](https://github.com/santifer/career-ops/issues/352)) ([7c5fecb](https://github.com/santifer/career-ops/commit/7c5fecb00d60521f77b33724eb345a28257d8832))
* **liveness:** detect closed postings with applications-closed banner variants ([7f8217e](https://github.com/santifer/career-ops/commit/7f8217e057b327980a797a682c4f01d3318edbbe))
* **merge-tracker:** filter seniority and location stopwords + require overlap ratio in roleFuzzyMatch ([7821113](https://github.com/santifer/career-ops/commit/7821113261eeb32f99639ff076651ab2e7757209))
* **pt:** restore diacritical marks in PT-BR modes ([#358](https://github.com/santifer/career-ops/issues/358)) ([3a4c596](https://github.com/santifer/career-ops/commit/3a4c596cb0a522f562ba38b35c210facaf38a503))
* **pt:** restore diacritical marks in PT-BR modes ([#359](https://github.com/santifer/career-ops/issues/359)) ([3a4c596](https://github.com/santifer/career-ops/commit/3a4c596cb0a522f562ba38b35c210facaf38a503))
* **update-system:** cross-check GitHub Releases API when VERSION file is stale ([b0ee6eb](https://github.com/santifer/career-ops/commit/b0ee6ebfcec7920ea7590ada61f3c39324d22ebc))
* **update-system:** expand SYSTEM_PATHS to cover all language modes and current scripts ([34fe3fb](https://github.com/santifer/career-ops/commit/34fe3fbd5782f7f57faf8ef4a245fbee6275a040))

## [1.5.0](https://github.com/santifer/career-ops/compare/v1.4.0...v1.5.0) (2026-04-14)


### Features

* add --min-score flag to batch runner ([#249](https://github.com/santifer/career-ops/issues/249)) ([cb0c7f7](https://github.com/santifer/career-ops/commit/cb0c7f7d7d3b9f3f1c3dc75ccac0a08d2737c01e))
* add {{PHONE}} placeholder to CV template ([#287](https://github.com/santifer/career-ops/issues/287)) ([e71595f](https://github.com/santifer/career-ops/commit/e71595f8ba134971ecf1cc3c3420d9caf21eed43))
* **dashboard:** add manual refresh shortcut ([#246](https://github.com/santifer/career-ops/issues/246)) ([4b5093a](https://github.com/santifer/career-ops/commit/4b5093a8ef1733c449ec0821f722f996625fcb84))


### Bug Fixes

* add stopword filtering and overlap ratio to roleMatch ([#248](https://github.com/santifer/career-ops/issues/248)) ([4da772d](https://github.com/santifer/career-ops/commit/4da772d3a4996bc9ecbe2d384d1e9d2ed75b9819))
* **dashboard:** show dates in pipeline list ([#298](https://github.com/santifer/career-ops/issues/298)) ([e5e2a6c](https://github.com/santifer/career-ops/commit/e5e2a6cffe9a5b9f3cec862df25410d02ecc9aa4))
* ensure data/ and output/ dirs exist before writing in scripts ([#261](https://github.com/santifer/career-ops/issues/261)) ([4b834f6](https://github.com/santifer/career-ops/commit/4b834f6f7f8f1b647a6bf76e43b017dcbe9cd52f))
* remove wellfound, lever and remotefront from portals.example.yml ([#286](https://github.com/santifer/career-ops/issues/286)) ([ecd013c](https://github.com/santifer/career-ops/commit/ecd013cc6f59e3a1a8ef77d34e7abc15e8075ed3))

## [1.4.0](https://github.com/santifer/career-ops/compare/v1.3.0...v1.4.0) (2026-04-13)


### Features

* add GitHub Actions CI + auto-labeler + welcome bot + /run skill ([2ddf22a](https://github.com/santifer/career-ops/commit/2ddf22a6a2731b38bcaed5786c4855c4ab9fe722))
* **dashboard:** add Catppuccin Latte light theme with auto-detection ([ff686c8](https://github.com/santifer/career-ops/commit/ff686c8af97a7bf93565fe8eeac677f998cc9ece))
* **dashboard:** add progress analytics screen ([623c837](https://github.com/santifer/career-ops/commit/623c837bf3155fd5b7413554240071d40585dd7e))
* **dashboard:** add vim motions to pipeline screen ([#262](https://github.com/santifer/career-ops/issues/262)) ([d149e54](https://github.com/santifer/career-ops/commit/d149e541402db0c88161a71c73899cd1836a1b2d))
* **dashboard:** aligned tables and markdown syntax rendering in viewer ([dbd1d3f](https://github.com/santifer/career-ops/commit/dbd1d3f7177358d0384d6e661d1b0dfc1f60bd4e))


### Bug Fixes

* **ci:** use pull_request_target for labeler on fork PRs ([#260](https://github.com/santifer/career-ops/issues/260)) ([2ecf572](https://github.com/santifer/career-ops/commit/2ecf57206c2eb6e35e2a843d6b8365f7a04c53d6))
* correct _shared.md → _profile.md reference in CUSTOMIZATION.md (closes [#137](https://github.com/santifer/career-ops/issues/137)) ([a91e264](https://github.com/santifer/career-ops/commit/a91e264b6ea047a76d8c033aa564fe01b8f9c1d9))
* replace grep -P with POSIX-compatible grep in batch-runner.sh ([637b39e](https://github.com/santifer/career-ops/commit/637b39e383d1174c8287f42e9534e9e3cdfabb19))
* test-all.mjs scans only git-tracked files, avoids false positives ([47c9f98](https://github.com/santifer/career-ops/commit/47c9f984d8ddc70974f15c99b081667b73f1bb9a))
* use execFileSync to prevent shell injection in test-all.mjs ([c99d5a6](https://github.com/santifer/career-ops/commit/c99d5a6526f923b56c3790b79b0349f402fa00e2))

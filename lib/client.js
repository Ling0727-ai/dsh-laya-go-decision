window.__ModuleLoader__.load({
	id: "dsh-laya-go-decision",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/** The key this plugin's row configuration registers under: `<package>#<row id>`. */
		const ROW_CONFIG_KEY = "dsh-laya-go-decision#laya-go-decision";
		/** Fields the page edits, in render order. */
		const FIELDS = [
			{
				field: "executable",
				label: "启动器路径 / Launcher path",
				hint: "layatrt-server.exe 的绝对路径；留空则回退到随插件发布的默认值（PATH 中的 layatrt-server.exe）。保存后会以新路径重启 launcher。",
				placeholder: "C:\\laya-go-launcher\\layatrt-server.exe"
			},
			{
				field: "serverCwd",
				label: "工作目录 / Working directory",
				hint: "launcher 的工作目录，模型目录与 layatrt.config.json 按它解析；留空则使用 DSH 进程目录。",
				placeholder: "C:\\laya-go-launcher"
			},
			{
				field: "baseUrl",
				label: "服务地址 / Base URL",
				hint: "Laya HTTP API 的地址，端口同时用于 --addr；留空回退到 http://127.0.0.1:8420。",
				placeholder: "http://127.0.0.1:8420"
			}
		];
		/** Contact-sheet of the styles this small page needs; no stylesheet ships with it. */
		const STYLE = {
			wrap: {
				display: "flex",
				flexDirection: "column",
				gap: "14px",
				maxWidth: "560px"
			},
			field: {
				display: "flex",
				flexDirection: "column",
				gap: "4px"
			},
			label: { fontWeight: 600 },
			hint: {
				opacity: .7,
				fontSize: "0.85em",
				lineHeight: 1.5
			},
			input: {
				padding: "6px 8px",
				border: "1px solid var(--dsh-border, rgba(127, 127, 127, 0.4))",
				borderRadius: "4px",
				background: "var(--dsh-input-background, transparent)",
				color: "inherit",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: "0.9em"
			},
			row: {
				display: "flex",
				gap: "8px",
				alignItems: "center"
			},
			button: {
				padding: "5px 12px",
				border: "1px solid var(--dsh-border, rgba(127, 127, 127, 0.4))",
				borderRadius: "4px",
				background: "transparent",
				color: "inherit",
				cursor: "pointer"
			},
			status: { fontSize: "0.85em" }
		};
		/** One editable field, rendered by {@link LayaGoConfigCard}. */
		function field(spec, text, disabled, onChange) {
			return (0, react.createElement)("label", {
				key: spec.field,
				style: STYLE.field
			}, (0, react.createElement)("span", { style: STYLE.label }, spec.label), (0, react.createElement)("input", {
				type: "text",
				style: STYLE.input,
				value: text,
				placeholder: spec.placeholder,
				spellCheck: false,
				disabled,
				onChange: (event) => {
					onChange(event.target.value);
				}
			}), (0, react.createElement)("span", { style: STYLE.hint }, spec.hint));
		}
		/**
		* The one-line summary the Plugins page shows for this row.
		* @param value - the resolved row configuration.
		* @returns the summary text.
		*/
		function summarizeConfig(value) {
			const executable = typeof value.executable === "string" && value.executable !== "" ? value.executable : "layatrt-server.exe（默认）";
			return `${String(value.mode ?? "managed")} · ${executable}`;
		}
		/**
		* Render this plugin's row configuration: its one-line summary, or the form.
		* @param props - the view the Plugins page asks for, plus the Host-owned form.
		* @returns the summary line, or the settings form.
		*/
		function LayaGoConfigCard(props) {
			const form = props.form;
			const [draft, setDraft] = (0, react.useState)(null);
			const [status, setStatus] = (0, react.useState)({ kind: "idle" });
			const value = form?.state.value ?? {};
			/** The accepted value of one field, or the bundle default when unset. */
			const acceptedOf = (fieldName) => {
				const accepted = value[fieldName];
				return typeof accepted === "string" ? accepted : "";
			};
			/** What the input shows: the user's draft, else the accepted value. */
			const shownOf = (fieldName) => draft?.[fieldName] ?? acceptedOf(fieldName);
			if (props.view === "summary") return (0, react.createElement)("span", null, summarizeConfig(value));
			const writable = form !== void 0 && form.state.writable && form.state.mode === "host";
			const statusText = status.kind === "saved" ? "已保存 / saved" : status.kind === "refused" ? "Host 拒绝了这次修改 / the Host refused the change" : status.kind === "failed" ? `保存失败 / save failed: ${status.detail ?? "unknown error"}` : void 0;
			const save = async () => {
				if (form === void 0) return;
				const ops = [];
				const next = (fieldName) => shownOf(fieldName).trim();
				for (const spec of FIELDS) {
					const wanted = next(spec.field);
					if (wanted === acceptedOf(spec.field)) continue;
					if (wanted === "") ops.push({
						op: "unset",
						path: [spec.field]
					});
					else ops.push({
						op: "set",
						path: [spec.field],
						value: wanted
					});
				}
				if (ops.length === 0) {
					setStatus({
						kind: "saved",
						detail: "no changes"
					});
					return;
				}
				try {
					setStatus(await form.mutate(ops, form.state.revision) ? { kind: "saved" } : { kind: "refused" });
				} catch (error) {
					setStatus({
						kind: "failed",
						detail: error instanceof Error ? error.message : String(error)
					});
				}
			};
			const reset = async () => {
				if (form === void 0) return;
				setDraft(null);
				try {
					setStatus(await form.mutate(FIELDS.map((spec) => ({
						op: "unset",
						path: [spec.field]
					})), form.state.revision) ? { kind: "saved" } : { kind: "refused" });
				} catch (error) {
					setStatus({
						kind: "failed",
						detail: error instanceof Error ? error.message : String(error)
					});
				}
			};
			if (form === void 0 || form.state.status === "loading") return (0, react.createElement)("div", { style: STYLE.wrap }, (0, react.createElement)("span", { style: STYLE.hint }, "正在读取配置… / loading configuration…"));
			if (form.state.status === "unavailable") return (0, react.createElement)("div", { style: STYLE.wrap }, (0, react.createElement)("span", { style: STYLE.hint }, "当前连接不提供可写的 profile 配置（memory 模式）/ this connection keeps preferences process-local, so the row configuration cannot be edited here."));
			return (0, react.createElement)("div", { style: STYLE.wrap }, ...FIELDS.map((spec) => field(spec, shownOf(spec.field), !writable, (text) => {
				setDraft((current) => ({
					...current,
					[spec.field]: text
				}));
			})), (0, react.createElement)("div", { style: STYLE.row }, (0, react.createElement)("button", {
				type: "button",
				style: STYLE.button,
				disabled: !writable,
				onClick: () => {
					save();
				}
			}, "保存 / Save"), (0, react.createElement)("button", {
				type: "button",
				style: STYLE.button,
				disabled: !writable,
				onClick: () => {
					reset();
				}
			}, "恢复默认 / Reset to defaults"), statusText === void 0 ? null : (0, react.createElement)("span", { style: STYLE.status }, statusText)), (0, react.createElement)("span", { style: STYLE.hint }, "保存写入 profile 的 cordis.patch.yml，并重新加载这个插件行；正在运行的 launcher 会用新配置重启（不会残留旧进程）。"));
		}
		/** Services this half needs: the slot registry its page registers into. */
		const inject = ["slots"];
		/**
		* Register the row configuration page.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
				name: "plugins.row.config",
				key: ROW_CONFIG_KEY
			}, LayaGoConfigCard)), "laya-go-decision: row configuration page");
		}
		//#endregion
		exports.LayaGoConfigCard = LayaGoConfigCard;
		exports.ROW_CONFIG_KEY = ROW_CONFIG_KEY;
		exports.apply = apply;
		exports.inject = inject;
		exports.summarizeConfig = summarizeConfig;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
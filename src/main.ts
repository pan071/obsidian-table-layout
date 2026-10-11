/**
 * 插件入口：组装表格定位、样式渲染、列宽交互与右键菜单，并注册命令和设置页
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
import { debounce, Editor, MarkdownFileInfo, MarkdownView, Plugin, TAbstractFile } from "obsidian";
import { autoFitTable, fillWidth, measureColumnWidths } from "./layout";
import { TableLocator } from "./locator";
import { TableMenu } from "./menu";
import { ColumnResizer } from "./resizer";
import { TableLayoutSettingTab } from "./settings";
import { TableStore } from "./store";
import { TableBinding, TableStyler } from "./styler";
import { DEFAULT_SETTINGS, TableLayoutData, TableLayoutSettings, ViewKind, WidthConfig } from "./types";

/** 开启「默认铺满」时添加到 body 的样式类 */
const FILL_DEFAULT_CLASS = "tl-fill-default";

/**
 * 表格布局插件：拖动调整列宽、双击自适应、铺满页面以及行/列/单元格对齐，样式保存在插件数据中，不改动笔记原文
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
export default class TableLayoutPlugin extends Plugin {
	/** 插件持久化数据 */
	private data: TableLayoutData = { settings: { ...DEFAULT_SETTINGS }, files: {} };
	/** 样式存储 */
	private store!: TableStore;
	/** 样式渲染器 */
	private styler!: TableStyler;
	/** 监听页面上表格的增删 */
	private observer: MutationObserver | null = null;
	/** 延迟写盘，合并短时间内的多次修改 */
	private readonly requestSave = debounce(() => void this.saveData(this.data), 500, true);

	/** 插件设置，与持久化数据中的 settings 为同一对象 */
	settings: TableLayoutSettings = this.data.settings;

	/**
	 * 插件加载
	 */
	async onload(): Promise<void> {
		await this.loadPluginData();

		// region 核心模块
		this.store = new TableStore(this.data, () => this.requestSave());
		const locator = new TableLocator(this.app);
		this.styler = new TableStyler(locator, this.store);
		this.store.onChange = () => this.styler.refresh();
		// 阅读视图渲染表格时登记上下文，用于换算表格在文件中的位置
		this.registerMarkdownPostProcessor((el, ctx) => {
			locator.registerReadingSection(el, ctx);
			this.styler.scheduleRefresh();
		});
		// endregion

		// region 交互
		const getSettings = () => this.settings;
		new ColumnResizer(this, this.styler, this.store, getSettings).register();
		new TableMenu(this.app, this, this.styler, this.store, getSettings).register();
		this.registerCommands();
		this.addSettingTab(new TableLayoutSettingTab(this.app, this));
		// endregion

		// region 文件变化与页面变化
		this.registerEvent(this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => this.store.renameFile(oldPath, file.path)));
		this.registerEvent(this.app.vault.on("delete", (file: TAbstractFile) => this.store.deleteFile(file.path)));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.styler.scheduleRefresh()));
		this.app.workspace.onLayoutReady(() => {
			this.styler.start();
			this.observeTables();
		});
		// endregion

		this.applyBodyClass();
	}

	/**
	 * 插件卸载：断开监听、移除样式
	 */
	onunload(): void {
		// 立即写入尚未保存的修改
		this.requestSave.run();
		this.observer?.disconnect();
		this.observer = null;
		this.styler?.stop();
		document.body.removeClass(FILL_DEFAULT_CLASS, "tl-col-resize-hover", "tl-resizing");
	}

	/**
	 * 监听页面 DOM 变化：有表格新增时立即渲染（避免闪烁），其余变化延迟刷新以更新表格序号
	 */
	private observeTables(): void {
		this.observer = new MutationObserver((mutations) => {
			const hasTable = mutations.some((mutation) =>
				Array.from(mutation.addedNodes).some(
					(node) => node instanceof HTMLElement && (node.tagName === "TABLE" || node.querySelector("table") !== null),
				),
			);
			if (hasTable) {
				this.styler.refresh();
			} else {
				this.styler.scheduleRefresh();
			}
		});
		this.observer.observe(document.body, { childList: true, subtree: true });
	}

	/**
	 * 注册命令：作用于实时预览中光标所在的表格
	 */
	private registerCommands(): void {
		const commands: [string, string, (binding: TableBinding) => WidthConfig | undefined][] = [
			["fit-page", "当前表格铺满页面宽度", (binding) => fillWidth(measureColumnWidths(binding.table))],
			["auto-fit-table", "当前表格按内容自适应列宽", (binding) => autoFitTable(binding, this.settings)],
			["reset-width", "当前表格恢复默认列宽", () => undefined],
		];
		for (const [id, name, compute] of commands) {
			this.addCommand({
				id,
				name,
				editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
					const binding = this.findTableAtCursor(editor, ctx);
					if (!binding) {
						return false;
					}
					if (!checking) {
						const { path, tables, index } = binding.location;
						this.store.setWidth(path, this.store.ensure(path, tables, index), compute(binding));
					}
					return true;
				},
			});
		}
	}

	/**
	 * 找到实时预览中光标所在的表格
	 *
	 * @param editor 当前编辑器
	 * @param ctx 当前视图
	 * @return 表格绑定，光标不在表格内时返回 null
	 */
	private findTableAtCursor(editor: Editor, ctx: MarkdownView | MarkdownFileInfo): TableBinding | null {
		const path = ctx.file?.path;
		const line = editor.getCursor().line;
		for (const binding of this.styler.allBindings()) {
			const { kind, tables, index } = binding.location;
			const table = tables[index];
			if (kind === ViewKind.LivePreview && binding.location.path === path && table.startLine <= line && line <= table.endLine) {
				// 只取当前视图里的表格
				if (ctx instanceof MarkdownView && !ctx.containerEl.contains(binding.table)) {
					continue;
				}
				return this.styler.getBinding(binding.table);
			}
		}
		return null;
	}

	/**
	 * 按设置切换 body 上的默认铺满样式类
	 */
	private applyBodyClass(): void {
		document.body.toggleClass(FILL_DEFAULT_CLASS, this.settings.fillByDefault);
	}

	/**
	 * 加载数据，缺失项使用默认值
	 */
	private async loadPluginData(): Promise<void> {
		const saved = ((await this.loadData()) ?? {}) as Partial<TableLayoutData>;
		this.data = {
			settings: Object.assign({}, DEFAULT_SETTINGS, saved.settings),
			files: saved.files ?? {},
		};
		this.settings = this.data.settings;
	}

	/**
	 * 保存设置并重新渲染
	 */
	async saveSettings(): Promise<void> {
		await this.saveData(this.data);
		this.applyBodyClass();
		this.styler.refresh();
	}
}

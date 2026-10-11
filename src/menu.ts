/**
 * 右键菜单：在表格单元格的右键菜单中追加「表格布局」子菜单，提供对齐、表格位置与列宽操作
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
import { App, Component, Menu, MenuItem, Notice } from "obsidian";
import { autoFitColumn, autoFitTable, currentMode, fillWidth, measureColumnWidths } from "./layout";
import { AlignTarget, TableStore } from "./store";
import { TableBinding, TableStyler } from "./styler";
import {
	AlignProp,
	AlignScope,
	HORIZONTAL_ALIGN_LABELS,
	HorizontalAlign,
	TABLE_POSITION_LABELS,
	TableLayoutSettings,
	TablePosition,
	VERTICAL_ALIGN_LABELS,
	VerticalAlign,
	WidthConfig,
	WidthMode,
} from "./types";

/**
 * 支持子菜单的菜单项（setSubmenu 为 Obsidian 运行时方法，未在公开类型中声明）
 */
type SubmenuCapable = MenuItem & { setSubmenu?: () => Menu };

/**
 * 一次右键所在的表格位置
 */
interface CellContext {
	/** 单元格 */
	cell: HTMLTableCellElement;
	/** 行号（0 为表头行） */
	row: number;
	/** 列号 */
	col: number;
	/** 右键的是 Obsidian 自带的列拖动手柄（列菜单）还是行拖动手柄（行菜单） */
	handle: AlignScope.Column | AlignScope.Row | null;
}

/**
 * 一组对齐目标及其在菜单中的名称
 */
interface TargetGroup {
	/** 菜单名称 */
	title: string;
	/** 菜单图标 */
	icon: string;
	/** 对齐目标 */
	targets: AlignTarget[];
}

/**
 * 表格右键菜单处理器
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
export class TableMenu {
	/** Obsidian 应用实例 */
	private readonly app: App;
	/** 用于注册事件的组件 */
	private readonly owner: Component;
	/** 样式渲染器 */
	private readonly styler: TableStyler;
	/** 样式存储 */
	private readonly store: TableStore;
	/** 读取最新设置 */
	private readonly getSettings: () => TableLayoutSettings;
	/** 正在编辑的单元格上的右键，交给编辑器菜单事件追加菜单项 */
	private pendingEditorMenu: { context: CellContext; time: number } | null = null;

	/**
	 * 创建菜单处理器
	 *
	 * @param app Obsidian 应用实例
	 * @param owner 用于注册事件的组件
	 * @param styler 样式渲染器
	 * @param store 样式存储
	 * @param getSettings 读取最新设置的方法
	 */
	constructor(app: App, owner: Component, styler: TableStyler, store: TableStore, getSettings: () => TableLayoutSettings) {
		this.app = app;
		this.owner = owner;
		this.styler = styler;
		this.store = store;
		this.getSettings = getSettings;
	}

	/**
	 * 注册右键事件与编辑器菜单事件
	 */
	register(): void {
		// 冒泡阶段处理：此时 Obsidian 已通过 Menu.forEvent 建好表格菜单，可直接往里追加
		this.owner.registerDomEvent(document, "contextmenu", this.onContextMenu);
		this.owner.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu) => {
				const pending = this.pendingEditorMenu;
				this.pendingEditorMenu = null;
				// 只处理刚刚在表格单元格内触发的编辑器菜单
				if (pending && Date.now() - pending.time < 1000) {
					this.appendItems(menu, pending.context);
				}
			}),
		);
	}

	/**
	 * 处理表格单元格上的右键
	 *
	 * @param evt 右键事件
	 */
	private readonly onContextMenu = (evt: MouseEvent): void => {
		const target = evt.target;
		if (!(target instanceof Element)) {
			return;
		}
		// 链接、图片保留各自的菜单
		if (target.closest("a, img, video")) {
			return;
		}
		const context = this.resolveContext(target);
		if (!context) {
			return;
		}
		// 正在编辑的单元格由编辑器自己弹菜单，改为在编辑器菜单事件中追加
		const active = document.activeElement;
		if (active && context.cell.contains(active) && active.closest(".cm-editor")) {
			this.pendingEditorMenu = { context, time: Date.now() };
			return;
		}
		// 与 Obsidian 共用同一个菜单；没有现成菜单时会新建并在稍后弹出
		this.appendItems(Menu.forEvent(evt), context);
	};

	/**
	 * 解析右键位置对应的单元格
	 *
	 * @param target 事件目标
	 * @return 单元格上下文，不在已绑定表格内时返回 null
	 */
	private resolveContext(target: Element): CellContext | null {
		const cell = target.closest<HTMLTableCellElement>("th, td");
		const table = cell?.closest("table");
		const row = cell?.parentElement;
		if (!cell || !table || !(row instanceof HTMLTableRowElement) || !this.styler.peekBinding(table)) {
			return null;
		}
		let handle: CellContext["handle"] = null;
		if (target.closest(".table-col-drag-handle")) {
			handle = AlignScope.Column;
		} else if (target.closest(".table-row-drag-handle")) {
			handle = AlignScope.Row;
		}
		return { cell, row: row.rowIndex, col: cell.cellIndex, handle };
	}

	/**
	 * 在菜单中追加「表格布局」子菜单
	 *
	 * @param menu 菜单
	 * @param context 单元格上下文
	 */
	private appendItems(menu: Menu, context: CellContext): void {
		const table = context.cell.closest("table");
		const binding = table ? this.styler.getBinding(table) : null;
		if (!binding) {
			return;
		}
		menu.addItem((item) => {
			item.setTitle("表格布局").setIcon("table").setSection("table-layout");
			const submenu = (item as SubmenuCapable).setSubmenu?.();
			// 旧版本 Obsidian 不支持子菜单
			if (!submenu) {
				item.setTitle("表格布局（需要更新 Obsidian）").setDisabled(true);
				return;
			}
			this.buildMenu(submenu, binding, context);
		});
	}

	/**
	 * 构建「表格布局」子菜单
	 *
	 * @param menu 子菜单
	 * @param binding 表格绑定
	 * @param context 单元格上下文
	 */
	private buildMenu(menu: Menu, binding: TableBinding, context: CellContext): void {
		// region 对齐
		for (const group of this.collectGroups(binding, context)) {
			menu.addItem((item) => {
				item.setTitle(group.title).setIcon(group.icon).setSection("align");
				const submenu = (item as SubmenuCapable).setSubmenu?.();
				if (submenu) {
					this.buildAlignMenu(submenu, binding, group.targets);
				}
			});
		}
		// endregion

		// region 表格位置
		const position = binding.record?.position ?? TablePosition.Left;
		for (const value of Object.values(TablePosition)) {
			const [title, icon] = TABLE_POSITION_LABELS[value];
			menu.addItem((item) =>
				item
					.setTitle(title)
					.setIcon(icon)
					.setSection("position")
					.setChecked(binding.record?.position !== undefined && position === value)
					.onClick(() => this.setPosition(binding, value)),
			);
		}
		// endregion

		// region 列宽
		menu.addItem((item) =>
			item
				.setTitle("铺满页面宽度")
				.setIcon("move-horizontal")
				.setSection("width")
				.onClick(() => this.saveWidth(binding, fillWidth(measureColumnWidths(binding.table)))),
		);
		menu.addItem((item) =>
			item
				.setTitle("整表按内容自适应")
				.setIcon("columns-3")
				.setSection("width")
				.onClick(() => this.saveWidth(binding, autoFitTable(binding, this.getSettings()))),
		);
		menu.addItem((item) =>
			item
				.setTitle("当前列按内容自适应")
				.setIcon("arrow-left-right")
				.setSection("width")
				.onClick(() => this.saveWidth(binding, autoFitColumn(binding, context.col, this.getSettings()))),
		);
		// endregion

		// region 重置
		menu.addItem((item) =>
			item
				.setTitle("恢复默认列宽")
				.setIcon("rotate-ccw")
				.setSection("reset")
				.setDisabled(!binding.record?.width)
				.onClick(() => {
					const record = binding.record;
					if (record) {
						this.store.setWidth(binding.location.path, record, undefined);
					}
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle("清除本表全部样式")
				.setIcon("eraser")
				.setSection("reset")
				.setWarning(true)
				.setDisabled(!binding.record)
				.onClick(() => {
					const record = binding.record;
					if (record) {
						this.store.reset(binding.location.path, record);
					}
				}),
		);
		// endregion
	}

	/**
	 * 构建某组目标的对齐子菜单
	 *
	 * @param menu 子菜单
	 * @param binding 表格绑定
	 * @param targets 对齐目标
	 */
	private buildAlignMenu(menu: Menu, binding: TableBinding, targets: AlignTarget[]): void {
		for (const value of Object.values(HorizontalAlign)) {
			const [title, icon] = HORIZONTAL_ALIGN_LABELS[value];
			menu.addItem((item) =>
				item
					.setTitle(title)
					.setIcon(icon)
					.setSection("horizontal")
					.onClick(() => this.setAlign(binding, targets, AlignProp.Horizontal, value)),
			);
		}
		for (const value of Object.values(VerticalAlign)) {
			const [title, icon] = VERTICAL_ALIGN_LABELS[value];
			menu.addItem((item) =>
				item
					.setTitle(title)
					.setIcon(icon)
					.setSection("vertical")
					.onClick(() => this.setAlign(binding, targets, AlignProp.Vertical, value)),
			);
		}
		menu.addItem((item) =>
			item
				.setTitle("清除对齐")
				.setIcon("eraser")
				.setSection("clear")
				.onClick(() => {
					const record = binding.record;
					if (!record) {
						return;
					}
					for (const target of targets) {
						this.store.clearAlign(binding.location.path, record, target);
					}
				}),
		);
	}

	/**
	 * 收集可选的对齐目标组：选中区域（实时预览）、单元格、行、列、整表
	 *
	 * @param binding 表格绑定
	 * @param context 单元格上下文
	 * @return 目标组列表
	 */
	private collectGroups(binding: TableBinding, context: CellContext): TargetGroup[] {
		const { row, col } = context;
		const cellGroup: TargetGroup = { title: "当前单元格", icon: "square", targets: [{ scope: AlignScope.Cell, row, col }] };
		const rowGroup: TargetGroup = { title: "当前行", icon: "rows-3", targets: [{ scope: AlignScope.Row, row }] };
		const colGroup: TargetGroup = { title: "当前列", icon: "columns-3", targets: [{ scope: AlignScope.Column, col }] };
		const tableGroup: TargetGroup = { title: "整个表格", icon: "table", targets: [{ scope: AlignScope.Table }] };

		// 右键行/列拖动手柄时，把对应的行或列放在最前
		if (context.handle === AlignScope.Column) {
			return [colGroup, tableGroup];
		}
		if (context.handle === AlignScope.Row) {
			return [rowGroup, tableGroup];
		}
		const groups = [cellGroup, rowGroup, colGroup, tableGroup];
		// 实时预览中右键已选中的单元格时，增加「选中区域」
		const selection = this.selectionTargets(binding.table, context.cell);
		if (selection) {
			groups.unshift({ title: "选中区域", icon: "box-select", targets: selection });
		}
		return groups;
	}

	/**
	 * 把实时预览中选中的单元格换算为对齐目标：整表、整行、整列或逐个单元格
	 *
	 * @param table 表格元素
	 * @param cell 右键所在单元格
	 * @return 对齐目标，没有选中区域或右键不在选中区域内时返回 null
	 */
	private selectionTargets(table: HTMLTableElement, cell: HTMLTableCellElement): AlignTarget[] | null {
		const selected = Array.from(table.querySelectorAll<HTMLTableCellElement>("th.is-selected, td.is-selected"));
		if (selected.length < 2 || !selected.includes(cell)) {
			return null;
		}
		const rowCount = table.rows.length;
		const colCount = table.rows[0]?.cells.length ?? 0;
		const positions = selected.map((c) => ({ row: (c.parentElement as HTMLTableRowElement).rowIndex, col: c.cellIndex }));
		// 整表
		if (positions.length === rowCount * colCount) {
			return [{ scope: AlignScope.Table }];
		}
		const rows = Array.from(new Set(positions.map((p) => p.row)));
		const cols = Array.from(new Set(positions.map((p) => p.col)));
		// 选中的若干整行
		if (rows.every((r) => positions.filter((p) => p.row === r).length === colCount)) {
			return rows.map((r) => ({ scope: AlignScope.Row, row: r }));
		}
		// 选中的若干整列
		if (cols.every((c) => positions.filter((p) => p.col === c).length === rowCount)) {
			return cols.map((c) => ({ scope: AlignScope.Column, col: c }));
		}
		// 其他情况逐个单元格设置
		return positions.map((p) => ({ scope: AlignScope.Cell, row: p.row, col: p.col }));
	}

	// region 操作

	/**
	 * 对一组目标设置对齐
	 *
	 * @param binding 表格绑定
	 * @param targets 对齐目标
	 * @param prop 对齐属性
	 * @param value 对齐值
	 */
	private setAlign(binding: TableBinding, targets: AlignTarget[], prop: AlignProp, value: HorizontalAlign | VerticalAlign): void {
		const { path, tables, index } = binding.location;
		const record = this.store.ensure(path, tables, index);
		for (const target of targets) {
			this.store.setAlign(record, target, prop, value);
		}
	}

	/**
	 * 设置表格位置；表格铺满页面时位置不生效，给出提示
	 *
	 * @param binding 表格绑定
	 * @param position 表格位置
	 */
	private setPosition(binding: TableBinding, position: TablePosition): void {
		const { path, tables, index } = binding.location;
		this.store.setPosition(this.store.ensure(path, tables, index), position);
		if (currentMode(binding, this.getSettings()) === WidthMode.Fill) {
			new Notice("表格当前铺满页面，位置在表格变窄后生效：向左拖动最后一列的右边框即可缩窄表格。");
		}
	}

	/**
	 * 保存列宽配置
	 *
	 * @param binding 表格绑定
	 * @param width 列宽配置
	 */
	private saveWidth(binding: TableBinding, width: WidthConfig): void {
		const { path, tables, index } = binding.location;
		this.store.setWidth(path, this.store.ensure(path, tables, index), width);
	}

	// endregion
}

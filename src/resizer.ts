/**
 * 列宽交互：鼠标拖动列边框调整列宽、双击列边框按内容自适应
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
import { Component } from "obsidian";
import { autoFitColumn, currentMode, fillWidth, fixedWidth, measureColumnWidths, measureContainerWidth, snapWidth } from "./layout";
import { TableStore } from "./store";
import { TableBinding, TableStyler } from "./styler";
import { TableLayoutSettings, WidthConfig, WidthMode } from "./types";

/** 距列边框多少像素内视为命中边框 */
const EDGE_SIZE = 5;
/** 鼠标悬停在列边框上时添加到 body 的样式类 */
const HOVER_CLASS = "tl-col-resize-hover";
/** 拖动过程中添加到 body 的样式类 */
const RESIZING_CLASS = "tl-resizing";

/**
 * 列边框命中结果
 */
interface BorderHit {
	/** 表格绑定 */
	binding: TableBinding;
	/** 边框左侧的列号 */
	col: number;
}

/**
 * 一次拖动的状态
 */
interface DragSession {
	/** 命中的列边框 */
	hit: BorderHit;
	/** 按下时的鼠标横坐标 */
	startX: number;
	/** 按下时各列宽度 */
	start: number[];
	/** 拖动后的各列宽度 */
	current: number[];
	/** 页面宽度 */
	container: number;
	/** 按下时的列宽模式 */
	mode: WidthMode;
	/** 是否按住 Shift（只改当前列，表格总宽随之变化） */
	shift: boolean;
	/** 是否发生过实际移动 */
	moved: boolean;
}

/**
 * 列宽拖动与双击自适应处理器
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
export class ColumnResizer {
	/** 用于注册与自动清理事件的组件（插件实例） */
	private readonly owner: Component;
	/** 样式渲染器 */
	private readonly styler: TableStyler;
	/** 样式存储 */
	private readonly store: TableStore;
	/** 读取最新设置 */
	private readonly getSettings: () => TableLayoutSettings;
	/** 当前拖动状态 */
	private session: DragSession | null = null;
	/** 拖动结束后吞掉紧随其后的一次点击，避免进入单元格编辑 */
	private suppressClick = false;

	/**
	 * 创建处理器
	 *
	 * @param owner 用于注册事件的组件
	 * @param styler 样式渲染器
	 * @param store 样式存储
	 * @param getSettings 读取最新设置的方法
	 */
	constructor(owner: Component, styler: TableStyler, store: TableStore, getSettings: () => TableLayoutSettings) {
		this.owner = owner;
		this.styler = styler;
		this.store = store;
		this.getSettings = getSettings;
	}

	/**
	 * 注册全局事件；按下、点击、双击在捕获阶段处理，抢在 Obsidian 进入单元格编辑之前
	 */
	register(): void {
		this.owner.registerDomEvent(document, "pointermove", this.onHover);
		this.owner.registerDomEvent(document, "pointerdown", this.onPointerDown, { capture: true });
		this.owner.registerDomEvent(document, "click", this.onClick, { capture: true });
		this.owner.registerDomEvent(document, "dblclick", this.onDoubleClick, { capture: true });
		this.owner.register(() => this.endSession(false));
	}

	// region 事件处理

	/**
	 * 悬停在列边框上时切换为调整列宽的光标
	 *
	 * @param evt 鼠标移动事件
	 */
	private readonly onHover = (evt: PointerEvent): void => {
		if (this.session) {
			return;
		}
		document.body.toggleClass(HOVER_CLASS, this.hitTest(evt) !== null);
	};

	/**
	 * 在列边框上按下鼠标时开始拖动
	 *
	 * @param evt 鼠标按下事件
	 */
	private readonly onPointerDown = (evt: PointerEvent): void => {
		if (evt.button !== 0 || this.session) {
			return;
		}
		const hit = this.hitTest(evt);
		if (!hit) {
			return;
		}
		// 阻止 Obsidian 进入单元格编辑或开始选区
		evt.preventDefault();
		evt.stopPropagation();
		// 重新定位，确保拿到最新的样式记录
		const binding = this.styler.getBinding(hit.binding.table);
		if (!binding) {
			return;
		}
		const start = measureColumnWidths(binding.table);
		this.session = {
			hit: { binding, col: hit.col },
			startX: evt.clientX,
			start,
			current: [...start],
			container: measureContainerWidth(binding),
			mode: currentMode(binding, this.getSettings()),
			shift: evt.shiftKey,
			moved: false,
		};
		document.body.addClass(RESIZING_CLASS);
		document.body.removeClass(HOVER_CLASS);
		window.addEventListener("pointermove", this.onDragMove);
		window.addEventListener("pointerup", this.onDragEnd);
		window.addEventListener("pointercancel", this.onDragCancel);
	};

	/**
	 * 拖动中实时预览新列宽
	 *
	 * @param evt 鼠标移动事件
	 */
	private readonly onDragMove = (evt: PointerEvent): void => {
		const session = this.session;
		if (!session) {
			return;
		}
		const dx = evt.clientX - session.startX;
		if (Math.abs(dx) >= 1) {
			session.moved = true;
		}
		session.current = this.computeWidths(session, dx);
		// 拖动过程中统一以像素预览，结束时再换算为最终模式
		this.styler.setPreview(session.hit.binding.table, fixedWidth(session.current));
	};

	/**
	 * 松开鼠标时保存列宽
	 */
	private readonly onDragEnd = (): void => {
		this.endSession(true);
	};

	/**
	 * 拖动被系统打断时放弃修改
	 */
	private readonly onDragCancel = (): void => {
		this.endSession(false);
	};

	/**
	 * 拖动结束后吞掉一次点击
	 *
	 * @param evt 点击事件
	 */
	private readonly onClick = (evt: MouseEvent): void => {
		if (!this.suppressClick) {
			return;
		}
		this.suppressClick = false;
		evt.preventDefault();
		evt.stopPropagation();
	};

	/**
	 * 双击列边框时按内容自适应该列
	 *
	 * @param evt 双击事件
	 */
	private readonly onDoubleClick = (evt: MouseEvent): void => {
		const hit = this.hitTest(evt);
		if (!hit) {
			return;
		}
		evt.preventDefault();
		evt.stopPropagation();
		this.suppressClick = false;
		const binding = this.styler.getBinding(hit.binding.table);
		if (binding) {
			this.saveWidth(binding, autoFitColumn(binding, hit.col, this.getSettings()));
		}
	};

	// endregion

	/**
	 * 判断鼠标是否位于某个已绑定表格的列边框上
	 *
	 * @param evt 鼠标事件
	 * @return 命中结果，未命中时返回 null
	 */
	private hitTest(evt: MouseEvent): BorderHit | null {
		const target = evt.target;
		if (!(target instanceof Element)) {
			return null;
		}
		// Obsidian 自带的行列拖动手柄保持原有行为
		if (target.closest(".table-col-drag-handle, .table-row-drag-handle")) {
			return null;
		}
		const cell = target.closest<HTMLTableCellElement>("th, td");
		const table = cell?.closest("table");
		const binding = table ? this.styler.peekBinding(table) : null;
		if (!cell || !binding) {
			return null;
		}
		const rect = cell.getBoundingClientRect();
		const x = evt.clientX;
		// 靠近右边框：调整当前列
		if (rect.right - x <= EDGE_SIZE && rect.right - x >= -1) {
			return { binding, col: cell.cellIndex };
		}
		// 靠近左边框：调整前一列
		if (x - rect.left <= EDGE_SIZE && x - rect.left >= -1 && cell.cellIndex > 0) {
			return { binding, col: cell.cellIndex - 1 };
		}
		return null;
	}

	/**
	 * 根据鼠标位移计算新列宽
	 *
	 * @param session 拖动状态
	 * @param dx 鼠标水平位移
	 * @return 各列像素宽度
	 */
	private computeWidths(session: DragSession, dx: number): number[] {
		const min = this.getSettings().minColumnWidth;
		const { start, hit } = session;
		const col = hit.col;
		const widths = [...start];
		// 最后一列或按住 Shift：只改当前列，表格总宽随之变化
		if (session.shift || col === start.length - 1) {
			widths[col] = Math.max(min, start[col] + dx);
			return widths;
		}
		// 其余情况：与右侧相邻列互相让出宽度，表格总宽不变
		const pair = start[col] + start[col + 1];
		const left = Math.min(Math.max(start[col] + dx, min), pair - min);
		widths[col] = left;
		widths[col + 1] = pair - left;
		return widths;
	}

	/**
	 * 结束拖动
	 *
	 * @param commit 是否保存本次修改
	 */
	private endSession(commit: boolean): void {
		const session = this.session;
		if (!session) {
			return;
		}
		this.session = null;
		window.removeEventListener("pointermove", this.onDragMove);
		window.removeEventListener("pointerup", this.onDragEnd);
		window.removeEventListener("pointercancel", this.onDragCancel);
		document.body.removeClass(RESIZING_CLASS);

		const table = session.hit.binding.table;
		// 没有实际移动（如单击、双击的第一下）时不保存
		if (!commit || !session.moved) {
			this.styler.setPreview(table, null);
			return;
		}
		this.suppressClick = true;
		// 点击事件可能不会触发（如鼠标移出窗口），稍后自动复位
		window.setTimeout(() => (this.suppressClick = false), 300);
		this.styler.setPreview(table, null, false);
		this.saveWidth(session.hit.binding, this.resolveWidth(session));
	}

	/**
	 * 决定拖动结束后的列宽模式
	 *
	 * @param session 拖动状态
	 * @return 列宽配置
	 */
	private resolveWidth(session: DragSession): WidthConfig {
		const totalChanged = session.shift || session.hit.col === session.start.length - 1;
		// 相邻列互让宽度时总宽不变，保持原模式
		if (!totalChanged) {
			return session.mode === WidthMode.Fill ? fillWidth(session.current) : fixedWidth(session.current);
		}
		// 总宽变化：接近页面宽度时吸附为铺满，否则为固定像素（可窄于页面或超宽滚动）
		return snapWidth(session.current, session.container);
	}

	/**
	 * 保存列宽配置
	 *
	 * @param binding 表格绑定
	 * @param width 列宽配置
	 */
	private saveWidth(binding: TableBinding, width: WidthConfig): void {
		const { path, tables, index } = binding.location;
		const record = this.store.ensure(path, tables, index);
		this.store.setWidth(path, record, width);
	}
}

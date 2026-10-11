/**
 * 列宽计算：测量当前列宽、容器宽度与内容自然宽度，并据此生成铺满、自适应等列宽配置
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
import { isLivePreview, TableBinding } from "./styler";
import { TableLayoutSettings, WidthConfig, WidthMode } from "./types";

/** 表格总宽与页面宽度相差不超过该值时吸附为铺满（像素） */
export const SNAP_THRESHOLD = 8;

/**
 * 测量表格当前各列的显示宽度
 *
 * @param table 表格元素
 * @return 各列像素宽度
 */
export function measureColumnWidths(table: HTMLTableElement): number[] {
	const firstRow = table.rows[0];
	if (!firstRow) {
		return [];
	}
	return Array.from(firstRow.cells).map((cell) => cell.getBoundingClientRect().width);
}

/**
 * 测量表格可用的页面宽度（容器内容区宽度）
 *
 * @param binding 表格绑定
 * @return 像素宽度
 */
export function measureContainerWidth(binding: TableBinding): number {
	// 实时预览以表格挂件为准（挂件两侧留有拖动手柄的内边距），阅读视图以表格所在区块为准
	const container = isLivePreview(binding) ? binding.table.closest<HTMLElement>(".cm-table-widget") ?? binding.host : binding.host;
	const style = getComputedStyle(container);
	return container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

/**
 * 测量某列内容不换行时的自然宽度（含单元格内边距与边框）
 *
 * @param table 表格元素
 * @param col 列号
 * @return 像素宽度
 */
export function measureNaturalWidth(table: HTMLTableElement, col: number): number {
	// 临时禁止换行，测量结束后立即恢复，期间不会发生绘制
	table.addClass("tl-measuring");
	let max = 0;
	try {
		for (const row of Array.from(table.rows)) {
			const cell = row.cells[col];
			if (!cell) {
				continue;
			}
			const content = findContentEl(cell);
			const range = document.createRange();
			range.selectNodeContents(content);
			const textWidth = range.getBoundingClientRect().width;
			max = Math.max(max, textWidth + horizontalExtras(cell) + (content === cell ? 0 : horizontalExtras(content)));
		}
	} finally {
		table.removeClass("tl-measuring");
	}
	// 留出少量余量，避免取整误差导致换行
	return Math.ceil(max) + 2;
}

/**
 * 找到单元格中实际显示内容的元素（实时预览为可见的 .table-cell-wrapper，避开拖动手柄）
 *
 * @param cell 单元格
 * @return 内容元素
 */
function findContentEl(cell: HTMLTableCellElement): HTMLElement {
	const wrappers = Array.from(cell.children).filter(
		(el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains("table-cell-wrapper") && el.offsetParent !== null,
	);
	return wrappers[wrappers.length - 1] ?? cell;
}

/**
 * 计算元素水平方向的内边距与边框之和
 *
 * @param el 元素
 * @return 像素宽度
 */
function horizontalExtras(el: HTMLElement): number {
	const style = getComputedStyle(el);
	return (
		parseFloat(style.paddingLeft) +
		parseFloat(style.paddingRight) +
		parseFloat(style.borderLeftWidth) +
		parseFloat(style.borderRightWidth)
	);
}

/**
 * 获取表格当前生效的列宽模式
 *
 * @param binding 表格绑定
 * @param settings 插件设置
 * @return 列宽模式
 */
export function currentMode(binding: TableBinding, settings: TableLayoutSettings): WidthMode {
	// 未调整过列宽时，按「默认铺满」设置判断
	return binding.record?.width?.mode ?? (settings.fillByDefault ? WidthMode.Fill : WidthMode.Fixed);
}

/**
 * 生成铺满模式的列宽配置（按各列宽度比例分配）
 *
 * @param widths 各列像素宽度
 * @return 列宽配置
 */
export function fillWidth(widths: number[]): WidthConfig {
	const total = widths.reduce((sum, w) => sum + w, 0) || 1;
	return { mode: WidthMode.Fill, values: widths.map((w) => w / total) };
}

/**
 * 生成固定像素模式的列宽配置
 *
 * @param widths 各列像素宽度
 * @return 列宽配置
 */
export function fixedWidth(widths: number[]): WidthConfig {
	return { mode: WidthMode.Fixed, values: widths.map((w) => Math.round(w)) };
}

/**
 * 按表格总宽与页面宽度的关系决定模式：接近页面宽度时吸附为铺满，否则为固定像素
 *
 * @param widths 各列像素宽度
 * @param container 页面宽度
 * @return 列宽配置
 */
export function snapWidth(widths: number[], container: number): WidthConfig {
	const total = widths.reduce((sum, w) => sum + w, 0);
	return Math.abs(total - container) <= SNAP_THRESHOLD ? fillWidth(widths) : fixedWidth(widths);
}

/**
 * 计算单列按内容自适应后的列宽配置
 *
 * @param binding 表格绑定
 * @param col 列号
 * @param settings 插件设置
 * @return 列宽配置
 */
export function autoFitColumn(binding: TableBinding, col: number, settings: TableLayoutSettings): WidthConfig {
	const { table } = binding;
	const current = measureColumnWidths(table);
	const container = measureContainerWidth(binding);
	const natural = clampWidth(measureNaturalWidth(table, col), settings);
	const values = [...current];
	values[col] = natural;

	// 只有一列时直接按内容宽度显示
	if (current.length === 1) {
		return fixedWidth(values);
	}
	// 铺满模式：其余列按原比例分摊剩余宽度，放不下时转为超宽
	if (currentMode(binding, settings) === WidthMode.Fill) {
		const others = current.reduce((sum, w, i) => (i === col ? sum : sum + w), 0);
		const remain = container - natural;
		if (others > 0 && remain >= settings.minColumnWidth * (current.length - 1)) {
			return fillWidth(current.map((w, i) => (i === col ? natural : (w * remain) / others)));
		}
	}
	return fixedWidth(values);
}

/**
 * 计算整表按内容自适应后的列宽配置：按各列内容宽度比例铺满页面
 *
 * @param binding 表格绑定
 * @param settings 插件设置
 * @return 列宽配置
 */
export function autoFitTable(binding: TableBinding, settings: TableLayoutSettings): WidthConfig {
	const { table } = binding;
	const count = table.rows[0]?.cells.length ?? 0;
	const naturals = Array.from({ length: count }, (_, col) => clampWidth(measureNaturalWidth(table, col), settings));
	return fillWidth(naturals);
}

/**
 * 把宽度限制在最小列宽与自适应上限之间
 *
 * @param width 像素宽度
 * @param settings 插件设置
 * @return 限制后的宽度
 */
function clampWidth(width: number, settings: TableLayoutSettings): number {
	return Math.min(Math.max(width, settings.minColumnWidth), Math.max(settings.autoFitMaxWidth, settings.minColumnWidth));
}

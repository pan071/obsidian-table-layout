/**
 * 样式生成：把表格样式记录转换为作用于单个表格的 CSS 规则
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
import { AlignProp, AlignRule, AlignScope, TablePosition, TableRecord, ViewKind, WidthConfig, WidthMode } from "./types";

/**
 * 生成单个表格的 CSS
 *
 * @param id 表格渲染编号（对应 data-tl-id）
 * @param kind 表格所在视图类型
 * @param record 样式记录，可为空
 * @param preview 拖动过程中的临时列宽，优先于记录中的列宽
 * @return CSS 文本
 */
export function buildTableCss(id: number, kind: ViewKind, record: TableRecord | null, preview?: WidthConfig): string {
	const table = `table[data-tl-id="${id}"]`;
	const host = `[data-tl-host="${id}"]`;
	const parts: string[] = [];
	const width = preview ?? record?.width;

	// region 列宽
	if (width) {
		parts.push(...buildWidthCss(table, host, kind, width, record?.position));
	}
	// endregion

	// region 对齐：按设置顺序输出，选择器优先级一致，后设置的规则自然覆盖先设置的
	const rules = [...(record?.rules ?? [])].sort((a, b) => a.seq - b.seq);
	for (const rule of rules) {
		parts.push(buildAlignCss(table, rule));
	}
	// endregion

	return parts.join("\n");
}

/**
 * 生成列宽与表格位置的 CSS
 *
 * @param table 表格选择器
 * @param host 表格容器选择器
 * @param kind 视图类型
 * @param width 列宽配置
 * @param position 表格位置
 * @return CSS 规则列表
 */
function buildWidthCss(table: string, host: string, kind: ViewKind, width: WidthConfig, position?: TablePosition): string[] {
	const parts: string[] = [];
	const fill = width.mode === WidthMode.Fill;
	const total = width.values.reduce((sum, v) => sum + v, 0);

	// 表格整体宽度：铺满模式 100%，固定模式为各列之和
	const tableWidth = fill ? "100%" : `${round(total)}px`;
	parts.push(`${table}{table-layout:fixed !important;width:${tableWidth} !important;min-width:${tableWidth} !important;max-width:none !important;}`);

	// 各列宽度写在首行单元格上，固定表格布局以首行为准
	width.values.forEach((value, i) => {
		const colWidth = fill ? `${round(value * 100, 4)}%` : `${round(value)}px`;
		parts.push(`${table} tr:first-child > :nth-child(${i + 1}){width:${colWidth} !important;box-sizing:border-box;}`);
	});

	// region 容器与表格位置
	if (kind === ViewKind.LivePreview) {
		// 实时预览的表格包裹层默认按内容收缩，铺满时需撑满
		parts.push(`${host}{width:${fill ? "100%" : "fit-content"} !important;${fill ? "" : positionMargin(position)}}`);
	} else {
		// 阅读视图超宽时在表格所在区块内横向滚动
		parts.push(`${host}{overflow-x:auto;}`);
		if (!fill) {
			parts.push(`${table}{${positionMargin(position)}}`);
		}
	}
	// endregion

	return parts;
}

/**
 * 生成表格位置对应的左右外边距
 *
 * @param position 表格位置
 * @return CSS 声明
 */
function positionMargin(position?: TablePosition): string {
	switch (position) {
		case TablePosition.Center:
			return "margin-left:auto !important;margin-right:auto !important;";
		case TablePosition.Right:
			return "margin-left:auto !important;margin-right:0 !important;";
		default:
			return "margin-left:0 !important;margin-right:auto !important;";
	}
}

/**
 * 生成一条对齐规则的 CSS
 *
 * @param table 表格选择器
 * @param rule 对齐规则
 * @return CSS 规则
 */
function buildAlignCss(table: string, rule: AlignRule): string {
	// :where() 不计入优先级，保证所有范围的规则优先级相同
	const cells = `${table} :where(${targetSelector(rule)})`;
	// 实时预览单元格内容包在 .table-cell-wrapper 中
	const wrappers = `${cells} > .table-cell-wrapper`;
	if (rule.prop === AlignProp.Horizontal) {
		return `${cells},${wrappers}{text-align:${rule.value} !important;}`;
	}
	// 实时预览的包裹层默认撑满单元格高度，需改为自适应高度垂直对齐才能生效
	return `${cells}{vertical-align:${rule.value} !important;}\n${wrappers}{height:auto !important;}`;
}

/**
 * 生成规则作用范围对应的单元格选择器
 *
 * @param rule 对齐规则
 * @return 单元格选择器
 */
function targetSelector(rule: AlignRule): string {
	const row = rule.row ?? 0;
	const col = (rule.col ?? 0) + 1;
	// 行号 0 为表头行，其余为 tbody 中的第 row 行
	const rowSelector = row === 0 ? "thead > tr" : `tbody > tr:nth-child(${row})`;
	switch (rule.scope) {
		case AlignScope.Table:
			return "th, td";
		case AlignScope.Column:
			return `tr > :nth-child(${col})`;
		case AlignScope.Row:
			return `${rowSelector} > *`;
		case AlignScope.Cell:
			return `${rowSelector} > :nth-child(${col})`;
	}
}

/**
 * 保留指定位数的小数
 *
 * @param value 数值
 * @param digits 小数位数
 * @return 处理后的数值
 */
function round(value: number, digits = 1): number {
	const factor = Math.pow(10, digits);
	return Math.round(value * factor) / factor;
}

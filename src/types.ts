/**
 * 表格布局插件的公共类型、枚举与默认配置
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */

/**
 * 单元格内容水平对齐方式
 */
export enum HorizontalAlign {
	/** 左对齐 */
	Left = "left",
	/** 水平居中 */
	Center = "center",
	/** 右对齐 */
	Right = "right",
}

/**
 * 单元格内容垂直对齐方式
 */
export enum VerticalAlign {
	/** 顶端对齐 */
	Top = "top",
	/** 垂直居中 */
	Middle = "middle",
	/** 底端对齐 */
	Bottom = "bottom",
}

/**
 * 对齐属性：区分水平与垂直两个互不影响的维度
 */
export enum AlignProp {
	/** 水平对齐 */
	Horizontal = "h",
	/** 垂直对齐 */
	Vertical = "v",
}

/**
 * 对齐规则的作用范围，同一单元格命中多条规则时取最后设置的一条
 */
export enum AlignScope {
	/** 整个表格 */
	Table = "table",
	/** 整行 */
	Row = "row",
	/** 整列 */
	Column = "col",
	/** 单个单元格 */
	Cell = "cell",
}

/**
 * 列宽模式
 */
export enum WidthMode {
	/** 铺满页面：列宽按比例分配，表格总宽始终等于页面宽度 */
	Fill = "fill",
	/** 固定像素：表格总宽由各列像素宽度相加，可窄于页面（按表格位置对齐）或超宽（横向滚动） */
	Fixed = "fixed",
}

/**
 * 表格在页面中的位置，仅在表格窄于页面时生效
 */
export enum TablePosition {
	/** 居左 */
	Left = "left",
	/** 居中 */
	Center = "center",
	/** 居右 */
	Right = "right",
}

/**
 * 表格所在的视图类型
 */
export enum ViewKind {
	/** 实时预览 */
	LivePreview = "lp",
	/** 阅读视图 */
	Reading = "reading",
}

/**
 * 一条对齐规则
 */
export interface AlignRule {
	/** 作用范围 */
	scope: AlignScope;
	/** 行号（0 为表头行），范围为行或单元格时有值 */
	row?: number;
	/** 列号（从 0 开始），范围为列或单元格时有值 */
	col?: number;
	/** 对齐属性 */
	prop: AlignProp;
	/** 对齐值，水平取 HorizontalAlign，垂直取 VerticalAlign */
	value: HorizontalAlign | VerticalAlign;
	/** 设置序号，越大越晚设置，冲突时序号大的生效 */
	seq: number;
}

/**
 * 列宽配置
 */
export interface WidthConfig {
	/** 列宽模式 */
	mode: WidthMode;
	/** 各列宽度：铺满模式为比例（总和为 1），固定模式为像素 */
	values: number[];
}

/**
 * 单个表格的样式记录，按文件路径分组保存在插件数据中
 */
export interface TableRecord {
	/** 表格在文件中的序号（从 0 开始） */
	index: number;
	/** 表头各单元格原文，用于表格移动或增删列后重新匹配 */
	header: string[];
	/** 每个数据行首个单元格原文，用于增删行后重新匹配行样式 */
	rowKeys: string[];
	/** 列宽配置，未设置时使用默认布局 */
	width?: WidthConfig;
	/** 表格在页面中的位置 */
	position?: TablePosition;
	/** 对齐规则 */
	rules: AlignRule[];
	/** 下一条对齐规则使用的序号 */
	seq: number;
}

/**
 * 插件设置
 */
export interface TableLayoutSettings {
	/** 未调整过列宽的表格是否默认铺满页面宽度 */
	fillByDefault: boolean;
	/** 拖动时允许的最小列宽（像素） */
	minColumnWidth: number;
	/** 按内容自适应时单列的最大宽度（像素） */
	autoFitMaxWidth: number;
}

/**
 * 插件持久化数据
 */
export interface TableLayoutData {
	/** 插件设置 */
	settings: TableLayoutSettings;
	/** 表格样式记录，键为库内文件路径 */
	files: Record<string, TableRecord[]>;
}

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS: TableLayoutSettings = {
	fillByDefault: true,
	minColumnWidth: 40,
	autoFitMaxWidth: 600,
};

/**
 * 水平对齐在菜单中的展示名称与图标
 */
export const HORIZONTAL_ALIGN_LABELS: Record<HorizontalAlign, [string, string]> = {
	[HorizontalAlign.Left]: ["左对齐", "align-left"],
	[HorizontalAlign.Center]: ["水平居中", "align-center"],
	[HorizontalAlign.Right]: ["右对齐", "align-right"],
};

/**
 * 垂直对齐在菜单中的展示名称与图标
 */
export const VERTICAL_ALIGN_LABELS: Record<VerticalAlign, [string, string]> = {
	[VerticalAlign.Top]: ["顶端对齐", "align-start-horizontal"],
	[VerticalAlign.Middle]: ["垂直居中", "align-center-horizontal"],
	[VerticalAlign.Bottom]: ["底端对齐", "align-end-horizontal"],
};

/**
 * 表格位置在菜单中的展示名称与图标
 */
export const TABLE_POSITION_LABELS: Record<TablePosition, [string, string]> = {
	[TablePosition.Left]: ["表格居左", "align-horizontal-justify-start"],
	[TablePosition.Center]: ["表格居中", "align-horizontal-justify-center"],
	[TablePosition.Right]: ["表格居右", "align-horizontal-justify-end"],
};

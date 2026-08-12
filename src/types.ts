export type PageBox = 'media' | 'crop' | 'bleed' | 'trim' | 'art'

export interface Layer {
  /** pdfjs internal OCG id — used by the viewer to call setVisibility */
  id: string
  /** human-readable label; used as correlation key with pdf-lib */
  name: string
  /** current visibility state */
  visible: boolean
}

export interface StitchSettings {
  /** 1-based inclusive range. null = all pages */
  pageRange: [number, number] | null
  columns: number
  /** Desired row count when fillOrder is 'column'; columns is kept derived from this. */
  rows: number
  /** Horizontal overlap between tiles, in mm */
  overlapX: number
  /** Vertical overlap between tiles, in mm */
  overlapY: number
  /**
   * Ordered tile sequence. Numbers are 1-based within the page range; null = blank tile.
   * Empty array = natural order with no blanks (computed at stitch time).
   */
  tileSequence: (number | null)[]
  /** Which PDF box defines tile dimensions. Default: 'trim' */
  pageBox: PageBox
  /** Order in which the natural tile sequence is filled. Default: 'row' */
  fillOrder: 'row' | 'column'
  /** Horizontal fill direction. Default: 'ltr' */
  horizontalFlow: 'ltr' | 'rtl'
  /** Vertical fill direction. Default: 'ttb' */
  verticalFlow: 'ttb' | 'btt'
  /**
   * Manual per-tile rotation overrides, keyed by absolute 0-based source page
   * index (survives page-range changes, unlike range-relative numbering).
   * Combined with the page's own detected /Rotate value at stitch time.
   */
  tileRotations: Partial<Record<number, 90 | 180 | 270>>
  /** Names of layers to suppress in the output PDF */
  disabledLayers: string[]
  /** Strip corner registration marks and border rectangles from source pages before stitching */
  removeBorders?: boolean
}

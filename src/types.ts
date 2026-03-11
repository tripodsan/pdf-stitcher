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
  /** Horizontal overlap between tiles, in mm */
  overlapX: number
  /** Vertical overlap between tiles, in mm */
  overlapY: number
  /**
   * 1-based positions in the final tile sequence where blank tiles are inserted.
   * e.g. [1, 4] inserts a blank as the 1st and 4th tile; source pages fill the rest.
   */
  blankSlots: number[]
  /** Which PDF box defines tile dimensions. Default: 'trim' */
  pageBox: PageBox
  /** Names of layers to suppress in the output PDF */
  disabledLayers: string[]
}

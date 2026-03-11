export interface StitchSettings {
  /** 1-based inclusive range. null = all pages */
  pageRange: [number, number] | null
  columns: number
  rows: number
  /** Horizontal overlap between tiles, in mm */
  overlapX: number
  /** Vertical overlap between tiles, in mm */
  overlapY: number
  /**
   * 1-based positions in the final tile sequence where blank tiles are inserted.
   * e.g. [1, 4] inserts a blank as the 1st and 4th tile; source pages fill the rest.
   */
  blankSlots: number[]
}

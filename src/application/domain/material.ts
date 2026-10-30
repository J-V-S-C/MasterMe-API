export type SupportedLocale = 'pt-BR' | 'en-US';
export type GeneratedLocale = SupportedLocale | 'und';
export type MaterialKind = 'BOOK' | 'ARTICLE' | 'TEXT';
export interface MaterialOutlineUnit {
  order: number;
  title: string | null;
  level: number;
  startOffset: number;
  endOffset: number;
  provenance: 'HEADING' | 'PDF_OUTLINE' | 'UNSTRUCTURED' | 'STUDENT';
  pageNumber?: number;
}
export interface StudyMaterial {
  id: string;
  title: string;
  content: string;
  locale: SupportedLocale;
  createdAt: string;
  sourceType?: 'TEXT' | 'PDF' | 'MARKDOWN' | 'TXT';
  materialKind?: MaterialKind;
}
export type MaterialSummary = Omit<StudyMaterial, 'content'>;

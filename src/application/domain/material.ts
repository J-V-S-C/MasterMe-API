export type SupportedLocale = 'pt-BR' | 'en-US';
export type GeneratedLocale = SupportedLocale | 'und';
export interface StudyMaterial {
  id: string;
  title: string;
  content: string;
  locale: SupportedLocale;
  createdAt: string;
}
export type MaterialSummary = Omit<StudyMaterial, 'content'>;

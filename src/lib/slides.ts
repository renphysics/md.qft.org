import { renderMarkdownSlides, type RenderOptions, type SlidesMarkdownResult } from './render-markdown';

export type SlideTheme = 'paper' | 'midnight' | 'serif';
export type SlideRatio = '16:9' | '4:3';
export interface SlideSettings { theme: SlideTheme; ratio: SlideRatio }
export type SlidesResult = SlidesMarkdownResult;
export type SlideResult = SlidesMarkdownResult;

export const DEFAULT_SLIDE_SETTINGS: Readonly<SlideSettings> = { theme: 'paper', ratio: '16:9' };

export function normalizeSlideSettings(value: unknown): SlideSettings {
  const settings = value && typeof value === 'object' ? value as Partial<SlideSettings> : {};
  return {
    theme: settings.theme === 'midnight' || settings.theme === 'serif' ? settings.theme : 'paper',
    ratio: settings.ratio === '4:3' ? '4:3' : '16:9',
  };
}

export function slideDimensions(value: unknown = DEFAULT_SLIDE_SETTINGS): { width: number; height: number } {
  return { width: 1280, height: normalizeSlideSettings(value).ratio === '4:3' ? 960 : 720 };
}

export function renderSlides(source: string, options: RenderOptions = {}): SlidesResult {
  return renderMarkdownSlides(source, options);
}

import type { APIRoute } from 'astro';
import { withBase } from '../lib/site-path';
import { robotsText } from '../lib/site-seo';

export const GET: APIRoute = ({ site }) => new Response(
  robotsText(new URL(withBase(), site).href),
  { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
);

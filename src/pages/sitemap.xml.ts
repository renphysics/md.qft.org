import type { APIRoute } from 'astro';
import { withBase } from '../lib/site-path';
import { sitemapXml } from '../lib/site-seo';

export const GET: APIRoute = ({ site }) => new Response(
  sitemapXml(new URL(withBase(), site).href),
  { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
);

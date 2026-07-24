import { MetadataRoute } from 'next';
import { siteConfig } from '@phoenix/config';

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ['', '/platform', '/pbrs', '/products', '/solutions', '/resources', '/about', '/contact', '/privacy', '/terms'];

  return routes.map((route) => ({
    url: `${siteConfig.url}${route}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: route === '' ? 1 : 0.8,
  }));
}

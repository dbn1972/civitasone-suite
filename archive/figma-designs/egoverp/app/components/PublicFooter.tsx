import { useNavigate } from 'react-router';

export function PublicFooter() {
  const navigate = useNavigate();

  const getLinkPath = (linkText: string) => {
    const linkMap: Record<string, string> = {
      'Features': '/features',
      'Integrations': '/integrations',
      'Pricing': '/pricing',
      'Changelog': '/changelog',
      'Roadmap': '/roadmap',
      'Small Office': '/editions/small-office',
      'PSU': '/editions/psu',
      'Govt Department': '/editions/government',
      'Compare Editions': '/editions/compare',
      'Documentation': '/resources/documentation',
      'API Reference': '/resources/api',
      'About Us': '/company/about',
      'Contact': '/company/contact',
      'Terms of Service': '/legal/terms',
      'Privacy Policy': '/legal/privacy',
      'Cookie Policy': '/legal/cookie-policy',
      'Accessibility': '/legal/accessibility',
      'Trademarks': '/legal/trademarks',
    };
    return linkMap[linkText] || '#';
  };

  return (
    <footer className="bg-surface-raised border-t-2 border-border-subtle py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          {[
            { title: 'Product', links: ['Features', 'Integrations', 'Pricing', 'Changelog', 'Roadmap'] },
            { title: 'Editions', links: ['Small Office', 'PSU', 'Govt Department', 'Compare Editions'] },
            { title: 'Resources', links: ['Documentation', 'API Reference'] },
            { title: 'Company', links: ['About Us', 'Contact'] },
            { title: 'Legal', links: ['Terms of Service', 'Privacy Policy', 'Cookie Policy', 'Accessibility', 'Trademarks'] },
          ].map((column, index) => (
            <div key={index}>
              <h3 className="text-body-sm font-semibold text-text-primary mb-4">{column.title}</h3>
              <ul className="space-y-3">
                {column.links.map((link) => (
                  <li key={link}>
                    <a
                      href={getLinkPath(link)}
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(getLinkPath(link));
                      }}
                      className="text-caption text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-8 border-t border-border-subtle flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-caption text-text-muted">
            © 2026 CivitasOne Technologies Pvt. Ltd. All rights reserved.
          </div>
          <div className="flex items-center gap-6">
            <a href="/status" className="flex items-center gap-2 text-caption text-text-muted hover:text-text-primary transition-colors">
              <div className="size-2 bg-intent-success rounded-full animate-pulse" />
              All Systems Operational
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

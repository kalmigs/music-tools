import { Home, type LucideIcon } from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon?: LucideIcon;
  description?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const navItems: NavGroup[] = [
  {
    title: 'General',
    items: [
      {
        title: 'Home',
        href: '/',
        icon: Home,
        description: 'Welcome to Music Tools',
      },
    ],
  },
  // Add more groups as you build features:
  // {
  //   title: 'Generate',
  //   items: [
  //     { title: 'Scales', href: '/generate/scales', icon: Music },
  //     { title: 'Chords', href: '/generate/chords', icon: Piano },
  //   ],
  // },
];

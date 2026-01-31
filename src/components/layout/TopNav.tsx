import { Link } from '@tanstack/react-router';
import { Menu, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSidebar } from './SidebarContext';
import { ThemeToggle } from './ThemeToggle';

export function TopNav() {
  const { toggle } = useSidebar();

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Button variant="ghost" size="icon" onClick={toggle}>
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle sidebar</span>
      </Button>

      <Link to="/" className="flex items-center gap-2 font-semibold">
        <Music className="h-5 w-5" />
        <span>Music Tools</span>
      </Link>

      <nav className="ml-auto flex items-center gap-2">
        <ThemeToggle />
      </nav>
    </header>
  );
}

import { useState } from 'react';
import { ChevronsUpDown, FolderKanban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Project } from '../types';

export default function ProjectPicker({
  projects,
  value,
  onValueChange,
}: {
  projects: Project[];
  value: string;
  onValueChange: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = projects.find((project) => project.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="选择项目"
          aria-expanded={open}
          disabled={!projects.length}
          className="w-full justify-between gap-2"
        >
          <FolderKanban data-icon="inline-start" />
          <span className="flex-1 truncate text-left">{selected?.name || '尚无项目'}</span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput aria-label="搜索项目" placeholder="搜索项目名称或描述…" />
          <CommandList>
            <CommandEmpty>没有匹配的项目</CommandEmpty>
            <CommandGroup heading="项目空间">
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={project.id}
                  keywords={[project.name, project.description]}
                  data-checked={project.id === value}
                  onSelect={() => {
                    onValueChange(project.id);
                    setOpen(false);
                  }}
                >
                  <FolderKanban />
                  <span className="flex-1 truncate">{project.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

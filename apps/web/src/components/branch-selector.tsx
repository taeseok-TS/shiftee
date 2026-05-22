"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAllBranches } from "@/lib/branches";

interface BranchSelectorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
}

export function BranchSelector({
  value,
  onChange,
  placeholder = "지점 선택",
  disabled = false,
  allowEmpty = true,
}: BranchSelectorProps) {
  const branches = getAllBranches();

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value="">선택 안 함</SelectItem>}
        {branches.map((branch) => (
          <SelectItem key={branch.name} value={branch.name}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{branch.letter}</span>
              <span className="text-sm">{branch.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

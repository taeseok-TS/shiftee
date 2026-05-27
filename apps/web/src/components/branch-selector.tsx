"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAllBranches, getBranchLetter } from "@/lib/branches";

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
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAllBranches().then(data => {
      setBranches(data);
      setLoading(false);
    });
  }, []);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || loading}>
      <SelectTrigger>
        <SelectValue placeholder={loading ? "로딩 중..." : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value="">선택 안 함</SelectItem>}
        {branches.map((branch) => (
          <SelectItem key={branch.id} value={branch.name}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{getBranchLetter(branch.name)}</span>
              <span className="text-sm">{branch.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

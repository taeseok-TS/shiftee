"use client";

// PDF 양식 칸 배치 편집기 화면(QA76 #22 2단계) — /admin/contract-templates/[id]/layout
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import LayoutEditor from "@/components/contracts/LayoutEditor";
import { parseLayout, type TemplateLayout } from "@/lib/contract-layout-core";

type Tmpl = { id: string; name: string; fileUrl: string; layout: unknown };

export default function TemplateLayoutPage() {
  const { id } = useParams<{ id: string }>();
  const [tmpl, setTmpl] = useState<Tmpl | null>(null);
  const [layout, setLayout] = useState<TemplateLayout | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/contract-templates/${id}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!alive) return;
      if (!r.ok || !d.template) { setErr(d.error || "템플릿을 불러오지 못했습니다."); return; }
      setTmpl(d.template);
      setLayout(parseLayout(d.template.layout));
    }).catch(() => { if (alive) setErr("템플릿을 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [id]);

  return (
    <div className="space-y-2">
      <Link href="/admin/contract-templates" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft size={14} />계약 템플릿 목록</Link>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!err && !tmpl && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {tmpl && !/\.pdf$/i.test(tmpl.fileUrl) && (
        <p className="text-sm text-gray-600">이 템플릿은 워드(.docx) 양식입니다. 워드 양식은 {"{칸}"} 태그로 자리를 잡고, 칸마다 채우는 방식은 템플릿 수정 창의 「칸 설정」에서 정합니다. 끌어다 놓는 편집기는 PDF 양식에서 씁니다.</p>
      )}
      {tmpl && /\.pdf$/i.test(tmpl.fileUrl) && <LayoutEditor templateId={tmpl.id} fileUrl={tmpl.fileUrl} name={tmpl.name} initial={layout} />}
    </div>
  );
}

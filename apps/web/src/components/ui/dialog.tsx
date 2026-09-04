"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // ⚠ 폭 규칙 (2026-09-03 수정)
          //  종전 기본값에 `sm:max-w-sm` 이 박혀 있었다. 반응형 변형이 나중에 오므로
          //  호출부가 `max-w-md`/`max-w-2xl` 을 줘도 640px 이상에서 **384px 로 눌렸다**
          //  — 모달 44곳이 전부 그랬고, 서명 모달 미리보기가 좁던 것도 이 때문이다.
          //  · 여백은 max-w 가 아니라 **w-** 로 잡는다. max-w 로 잡으면 호출부의 max-w 와
          //    같은 그룹이라 tailwind-merge 가 지워 버려 여백이 사라진다.
          //  · `sm:w-full` 을 함께 두면 안 된다 — 그룹이 달라 640px 이상에서 이 여백도,
          //    호출부의 `w-[90vw]`·`w-[95vw]` 도 통째로 무력화된다. 태블릿 폭에서 모달이
          //    화면 끝에 붙고 모서리.테두리가 잘렸다(2026-09-03 검증에서 실측).
          //  · 기본 폭은 호출부가 폭을 **안 줬을 때만** 붙인다.
          "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          // className 은 함수로도 올 수 있다(Base UI). 문자열일 때만 폭 지정 여부를 본다.
          // 호출부가 **팝업 자신의 폭**을 지정했는지 본다. 조각(class) 단위로 보고,
          // 변형 접두(`sm:` `xl:` `data-[state=open]:`)와 `!` 는 건너뛴 뒤 max-w- 로
          // 시작하는지 확인한다. 변형에 `&` 가 들어간 것(`[&>*]:max-w-full`)은 **자식**의
          // 폭이므로 제외한다 — 그런 걸 폭 지정으로 오인하면 기본 폭이 안 붙어 모달이
          // 화면 전체로 퍼진다(2026-09-04 검증에서 오탐 8종 실증).
          !(typeof className === "string" &&
            className.split(/\s+/).some((t) => /^(?:[^\s:&]+:)*!?max-w-/.test(t))) && "sm:max-w-sm",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}

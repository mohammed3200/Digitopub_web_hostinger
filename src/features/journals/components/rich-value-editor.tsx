"use client"

import { useEffect, useState, type ReactNode } from "react"
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Bold, Heading4, Italic, Link2, List, ListOrdered, Redo2, Undo2, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/src/lib/utils"

/**
 * #288: small rich-text editor for one Journal Details value. Emits HTML limited
 * to what the server keeps (p, br, strong, em, h4, ul, ol, li, a); the server
 * sanitizes again, so this configuration is for the editing experience, not safety.
 * Loaded only on the admin page (next/dynamic, ssr: false).
 */

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [4] },
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    // A forced empty paragraph after every list/heading would make short values look multi-block.
    trailingNode: false,
    link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
  }),
]

/** Same look as the public card (journal-details-grid.tsx), inside an input-like box. */
const CONTENT_CLASS = cn(
  "min-h-[4.5rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "[&_p]:my-0 [&_p+p]:mt-1.5 [&_h4]:mt-2 [&_h4]:mb-0.5 [&_h4]:text-xs [&_h4]:font-semibold [&_h4]:uppercase [&_h4]:tracking-wider",
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5",
  "[&_a]:text-primary [&_a]:underline",
)

/**
 * Turns what the manager typed into a link target, or null when it is not one we keep.
 * "name@example.org" becomes mailto:, a bare "example.org/page" becomes https://.
 */
export function toLinkHref(input: string): string | null {
  const v = input.trim()
  if (!v) return null
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return v
  if (/^[^\s@/:]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  try {
    const url = new URL(candidate)
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".") ? url.href : null
  } catch {
    return null
  }
}

interface RichValueEditorProps {
  id: string
  value: string
  onChange: (html: string) => void
  "aria-label"?: string
}

export function RichValueEditor({ id, value, onChange, "aria-label": ariaLabel }: RichValueEditorProps) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: { id, class: CONTENT_CLASS, role: "textbox", "aria-multiline": "true", ...(ariaLabel ? { "aria-label": ariaLabel } : {}) },
      // Only one heading level exists here; keep pasted Word/web headings as subheadings
      // instead of letting them fall back to plain paragraphs.
      transformPastedHTML: (html) => html.replace(/<(\/?)h[1-6](?=[\s>])/gi, "<$1h4"),
    },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
  })

  // Follow outside changes (Discard changes, a refetch after Save) without echoing them back.
  useEffect(() => {
    if (!editor) return
    const current = editor.isEmpty ? "" : editor.getHTML()
    if (value !== current) editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  if (!editor) {
    return <div className={cn(CONTENT_CLASS, "animate-pulse bg-muted/40")} aria-hidden="true" />
  }
  return (
    <div className="space-y-1.5">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      heading: editor.isActive("heading", { level: 4 }),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      link: editor.isActive("link"),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  })
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const [linkError, setLinkError] = useState(false)

  const openLink = () => {
    setLinkError(false)
    setLinkDraft((editor.getAttributes("link").href as string | undefined) ?? "")
  }
  const applyLink = () => {
    if (linkDraft === null) return
    if (!linkDraft.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      setLinkDraft(null)
      return
    }
    const href = toLinkHref(linkDraft)
    if (!href) {
      setLinkError(true)
      return
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
    setLinkDraft(null)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Formatting">
        <ToolButton label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold />
        </ToolButton>
        <ToolButton label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic />
        </ToolButton>
        <ToolButton label="Subheading" active={state.heading} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}>
          <Heading4 />
        </ToolButton>
        <ToolButton label="Bulleted list" active={state.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List />
        </ToolButton>
        <ToolButton label="Numbered list" active={state.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered />
        </ToolButton>
        <ToolButton label={state.link ? "Edit link" : "Add link"} active={state.link || linkDraft !== null} onClick={openLink}>
          <Link2 />
        </ToolButton>
        <ToolButton label="Remove link" disabled={!state.link} onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}>
          <Unlink />
        </ToolButton>
        <ToolButton label="Undo" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 />
        </ToolButton>
        <ToolButton label="Redo" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 />
        </ToolButton>
      </div>

      {linkDraft !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            value={linkDraft}
            placeholder="https://… or name@example.org"
            aria-label="Link address"
            aria-invalid={linkError}
            className="h-8 max-w-sm"
            onChange={(e) => {
              setLinkDraft(e.target.value)
              setLinkError(false)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                applyLink()
              } else if (e.key === "Escape") {
                setLinkDraft(null)
              }
            }}
          />
          <Button type="button" size="sm" onClick={applyLink}>Apply</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setLinkDraft(null)}>Cancel</Button>
          {linkError && (
            <p className="w-full text-xs text-destructive" role="alert">
              Use a web address (https://…) or an email address.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className="h-8 w-8 [&_svg]:h-4 [&_svg]:w-4"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      // Keep the text selection: a mousedown on the button would blur the editor first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

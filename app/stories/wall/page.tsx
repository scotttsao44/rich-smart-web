import Link from 'next/link';
import Image from 'next/image';
import { storyHighlights } from '@/lib/public-site-data';

export default function StoriesWallPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-black text-slate-950">活动花絮墙</h1>
        <p className="mt-3 max-w-3xl leading-7 text-slate-600">
          集中展示品牌活动、门店教育训练、系统上线与合作进度。首页只放精选，完整内容在这里。
        </p>
        <Link href="/" className="mt-4 inline-flex font-bold text-cyan-700">
          返回主站
        </Link>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {storyHighlights.map((story) => (
          <article key={story.id} className="overflow-hidden rounded-3xl border border-cyan-100 bg-white shadow-sm">
            {story.mediaUrl && story.mediaType === 'video' && (
              <video src={story.mediaUrl} controls muted playsInline preload="metadata" className="aspect-video w-full bg-slate-950 object-cover" />
            )}
            {story.mediaUrl && story.mediaType === 'image' && (
              <div className="relative aspect-video bg-slate-100">
                <Image src={story.mediaUrl} alt={story.title} fill className="object-cover" />
              </div>
            )}
            <div className="p-6">
            <p className="text-xs font-bold text-cyan-700">{story.category} / {story.date}</p>
            <h2 className="mt-3 text-xl font-bold text-slate-950">{story.title}</h2>
            <p className="mt-3 leading-7 text-slate-600">{story.description}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

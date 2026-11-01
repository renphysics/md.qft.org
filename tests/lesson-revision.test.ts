import assert from 'node:assert/strict';
import { it } from 'node:test';
import { compareLessonRevision, portableLessonSource, type RevisionDocument } from '../src/lib/lesson-revision.ts';
import { createLessonProject } from '../src/lib/lesson-project.ts';
import { imageReference } from '../src/lib/image-assets.ts';

function lesson(id:string): RevisionDocument {
  return { title:'Wave packets',source:`# Wave packets\n\n![Wave](${imageReference(id)})`,mode:'slides',
    project:{ ...createLessonProject('slides.md','lesson-id'),files:[{path:'demos/wave.html',content:'<canvas></canvas>'}],imagePaths:[{imageId:id,path:'images/wave.png'}] },
    images:[{id,name:'wave.png',type:'image/png',blob:new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'})}],
  };
}

it('does not report freshly allocated image IDs as changed lesson content', async () => {
  const before = lesson('old-image');
  const after = lesson('new-image');
  assert.equal(portableLessonSource(before),portableLessonSource(after));
  assert.deepEqual(await compareLessonRevision(before,after),[]);
});

it('reviews exact source, added/removed demos, image bytes and lesson settings', async () => {
  const before = lesson('old-image');
  const after = lesson('new-image');
  after.title = 'Revised wave packets';
  after.source += '\n\n## Discussion';
  after.project!.files = [{path:'demos/new.html',content:'<button>Explore</button>'}];
  after.images![0].blob = new Blob([new Uint8Array([137,80,78,72])],{type:'image/png'});
  const changes = await compareLessonRevision(before,after);
  assert.equal(changes.length,5);
  assert.equal(changes.find((change) => change.path === 'demos/wave.html')?.status,'removed');
  assert.equal(changes.find((change) => change.path === 'demos/new.html')?.after,'<button>Explore</button>');
  assert.equal(changes.find((change) => change.path === 'images/wave.png')?.status,'changed');
  assert.match(changes.find((change) => change.path === 'slides.md')!.after,/## Discussion/);
  assert.match(changes[0].after,/Revised wave packets/);
});

it('compares typed relative image paths and imported attachment references equally', async () => {
  const before = lesson('before');
  const after = lesson('after');
  before.project!.document = after.project!.document = 'lecture/slides.md';
  before.source = '# Wave packets\n\n![Wave](../images/wave.png)';
  assert.deepEqual(await compareLessonRevision(before,after),[]);
});

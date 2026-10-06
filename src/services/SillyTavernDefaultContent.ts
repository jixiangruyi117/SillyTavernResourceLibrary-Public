// Snapshot of SillyTavern release/default/content/index.json.
// Only resource types imported by SRL are listed. A filename match is never enough:
// the Git blob SHA must also match, so user-edited copies with the same name are preserved.

const DEFAULT_BLOBS = new Map<string, string>([
  ['themes/dark lite.json', 'b04fa5849bd5b1e198b4121dd087fffd96e02abe'],
  ['themes/cappuccino.json', '9b168397e9d405fee4e88721a9edcfe8c0269560'],
  ['themes/celestial macaron.json', 'db76bf6e43e8fd472a055738e2405dba4f538414'],
  ['themes/dark v 1.0.json', '76c9658bfee9872485a2d8f350c6961a308febd1'],
  ['themes/azure.json', '69a0b4305716c1381c0753b59f13c790a991f1b7'],
  ['characters/default_seraphina.png', '14f3c14250d01e699b284b8d2882e61abff8314a'],
  ['worlds/eldoria.json', '64b7e1046e3cbc6111fb397f26bf4122d767d2eb'],
  ['koboldai settings/deterministic.json', '260683b48142c5510b93ea2bba82ff59f4345480'],
  ['koboldai settings/neutral.json', '71c56262fe21e4a7bbfbf0c3b391e8e89496f72a'],
  ['koboldai settings/recoveredruins.json', '4e4118b987fe8d6fc8fca3f61234ea9ec07f6fc2'],
  ['koboldai settings/universal-creative.json', 'c25a878d32e0b74d93c6d29e0100ec7763724e6d'],
  ['koboldai settings/universal-light.json', 'c7325ce1d1b82b8ad3e02ec12400fbef0978622f'],
  ['koboldai settings/universal-super-creative.json', '712d2919bd269e7118f2a486471e3c108e85b263'],
  ['novelai settings/asper-kayra.json', '0b4b78e6d542e7df9edcb054891b4045f46e700d'],
  ['novelai settings/blended-coffee-kayra.json', '05f79638125c75dec1106c7bbe2751767b6b980d'],
  ['novelai settings/blook-kayra.json', '42cf9e00ae64ed9c3699273d68ed1e0bfb32c216'],
  ['novelai settings/carefree-kayra.json', 'a99f18d09c8b1f6e4a6c68b9ac8067804551583e'],
  ['novelai settings/cosmiccube-kayra.json', 'b818f6a503f128359783ee8a792b74fb81a32412'],
  ['novelai settings/edgewise-clio.json', '32b4544db9900a1a8a408903297650e3bd57026c'],
  ['novelai settings/fresh-coffee-clio.json', '729a4b4383742aaaebd2b01ecc1fade1b8349e66'],
  ['novelai settings/fresh-coffee-kayra.json', '162b8e7781496f03666ba586190944bf59ad9dd0'],
  ['novelai settings/green-active-writer-kayra.json', '635f3fbc1ebde160b65087ee5f3c5c9e03bf3aff'],
  ['novelai settings/keelback-clio.json', '5beba6606fce2fc3d06564e20f897481ea388681'],
  ['novelai settings/long-press-clio.json', 'c2900a2dea36d0c6c0fa5bb4d09e2efb2953cbc1'],
  ['novelai settings/pilotfish-kayra.json', '15a8726c62dd702565d5433cca28f88a4900de42'],
  ['novelai settings/pro_writer-kayra.json', '374f96ae3db32b7ad936be31048bad5e12fdae02'],
  ['novelai settings/stelenes-kayra.json', '68cb0b8de2586f97ca4e179026628caa757a5d2c'],
  ['novelai settings/talker-chat-clio.json', 'de93b11dc5219a0e7664421b219d8cbef3e7a442'],
  ['novelai settings/tea_time-kayra.json', '4d40d66cd00d2f4004ec22ce19680e929c2fc44f'],
  ['novelai settings/tesseract-kayra.json', 'f4e44a1236d4b243c40ff114b296ea33bad6a7f7'],
  ['novelai settings/vingt-un-clio.json', 'b6e594c754ee12ec302567a11afe97e02bd9c60c'],
  ['novelai settings/writers-daemon-kayra.json', '70561d483850fa50f7614cef243361f0b75a6449'],
  ['novelai settings/erato-dragonfruit.json', '4a1fd903c7f90f9876cd45dd686f19dd1b94cf81'],
  ['novelai settings/erato-golden arrow.json', 'e8b17dcd70462333dab8f1731d89f4ad1fb5291b'],
  ['novelai settings/erato-shosetsu.json', '14e97d09629b8439a9f311fc01c29982a7631f9c'],
  ['novelai settings/erato-wilder.json', '474d540ccfe16aee132ab53b9f112d8c3f0a5732'],
  ['novelai settings/erato-zany scribe.json', '2f94d92bc0ed5ecca406a103fe97e6cf6e421f62'],
  ['textgen settings/default.json', 'f2a725319dd89003380d8f8427c909475eab8323'],
  ['textgen settings/deterministic.json', '3b2ebe808f51eafb924ce15347c49ad28bdf45f1'],
  ['textgen settings/neutral.json', 'f0e11f997265146aaca815e2b52cc85cc4350952'],
  ['textgen settings/universal-creative.json', '83e14043db39f46eff29f5f53947e3cff9862426'],
  ['textgen settings/universal-light.json', '22220ac3c0af93032a2b7648fe8b54a9ea0feebc'],
  ['textgen settings/universal-super-creative.json', '34476f9330ae0dbbacd3352adf9bc581eca5a9cb'],
  ['openai settings/default.json', '22b4a05ffeadf328655d7e11c0ea152a6e3d5eee'],
  ['quickreplies/default.json', '522b479f3bcc42e585761c3ecbf6fba350b059bc'],
])

function defaultLookupKey(path: string): string | undefined {
  const parts = path.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean)
  for (const directory of [
    'characters',
    'worlds',
    'themes',
    'quickreplies',
    'openai settings',
    'novelai settings',
    'koboldai settings',
    'textgen settings',
  ]) {
    const index = parts.lastIndexOf(directory)
    // Only the file directly inside a Tavern resource directory can be a stock
    // resource. A user-created subfolder such as themes/user/Dark Lite.json
    // must remain importable even when its bytes match the stock file.
    if (index >= 0 && index + 2 === parts.length) return `${directory}/${parts.at(-1)}`
  }
  return undefined
}

async function gitBlobSha(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`)
  const payload = new Uint8Array(header.byteLength + bytes.byteLength)
  payload.set(header)
  payload.set(bytes, header.byteLength)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', payload))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function isUnmodifiedSillyTavernDefault(path: string, blob: Blob): Promise<boolean> {
  const key = defaultLookupKey(path)
  if (!key) return false
  const expected = DEFAULT_BLOBS.get(key)
  if (!expected) return false
  return (await gitBlobSha(blob)) === expected
}

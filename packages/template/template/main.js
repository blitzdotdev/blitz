export async function main({viewer}) {
  window.viewer = viewer
}

export async function onError(error) {
  console.error('[blitz] Project failed to start', error)
}

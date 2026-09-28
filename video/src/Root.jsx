import { Composition } from 'remotion'
import { Demo, FPS, totalFrames } from './Demo'
import data from './segments.json'

export const Root = () => (
  <Composition id="HakDaarDemo" component={Demo} width={1920} height={1080} fps={FPS}
    durationInFrames={totalFrames(data)} defaultProps={{ data }} />
)

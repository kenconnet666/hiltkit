// 由 scripts/gen-attr-cases.mjs 从 09-attr/shared.js 生成，不要手改。
export const Generated = (
  <>
    {/* BOOL 属性：true 与空字符串为真，"false" 字符串不是合法值 */}
    <iframe allowfullscreen />
    <iframe allowfullscreen="" />
    <iframe allowfullscreen={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <iframe allowfullscreen="false" />
    <script async />
    <script async="" />
    <script async={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <script async="false" />
    <div autofocus />
    <div autofocus="" />
    <div autofocus={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <div autofocus="false" />
    <video autoplay />
    <video autoplay="" />
    <video autoplay={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <video autoplay="false" />
    <video controls />
    <video controls="" />
    <video controls={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <video controls="false" />
    <track default />
    <track default="" />
    <track default={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <track default="false" />
    <script defer />
    <script defer="" />
    <script defer={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <script defer="false" />
    <button disabled />
    <button disabled="" />
    <button disabled={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <button disabled="false" />
    <button formnovalidate />
    <button formnovalidate="" />
    <button formnovalidate={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <button formnovalidate="false" />
    <div hidden />
    <div hidden="" />
    <div hidden={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <div hidden="false" />
    <div inert />
    <div inert="" />
    <div inert={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <div inert="false" />
    <img ismap />
    <img ismap="" />
    <img ismap={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <img ismap="false" />
    <div itemscope />
    <div itemscope="" />
    <div itemscope={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <div itemscope="false" />
    <video loop />
    <video loop="" />
    <video loop={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <video loop="false" />
    <input type="file" multiple />
    <input type="file" multiple="" />
    <input type="file" multiple={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <input type="file" multiple="false" />
    <script nomodule />
    <script nomodule="" />
    <script nomodule={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <script nomodule="false" />
    <form novalidate />
    <form novalidate="" />
    <form novalidate={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <form novalidate="false" />
    <details open />
    <details open="" />
    <details open={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <details open="false" />
    <video playsinline />
    <video playsinline="" />
    <video playsinline={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <video playsinline="false" />
    <div popover />
    <div popover="" />
    <div popover={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <div popover="false" />
    <input readonly />
    <input readonly="" />
    <input readonly={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <input readonly="false" />
    <input required />
    <input required="" />
    <input required={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <input required="false" />
    <ol reversed />
    <ol reversed="" />
    <ol reversed={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <ol reversed="false" />
    <input type="file" webkitdirectory />
    <input type="file" webkitdirectory="" />
    <input type="file" webkitdirectory={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <input type="file" webkitdirectory="false" />
    <video disablepictureinpicture />
    <video disablepictureinpicture="" />
    <video disablepictureinpicture={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <video disablepictureinpicture="false" />
    <video disableremoteplayback />
    <video disableremoteplayback="" />
    <video disableremoteplayback={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <video disableremoteplayback="false" />
    <input type="checkbox" checked />
    <input type="checkbox" checked="" />
    <input type="checkbox" checked={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <input type="checkbox" checked="false" />
    <option selected />
    <option selected="" />
    <option selected={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <option selected="false" />
    <video muted />
    <video muted="" />
    <video muted={false} />
    {/* @ts-expect-error "false" 是真值 */}
    <video muted="false" />
    {/* ALIAS（React 拼写）：类型层必须拒绝并指向正确写法 */}
    {/* @ts-expect-error className → class */}
    <div className="x" />
    {/* @ts-expect-error htmlFor → for */}
    <div htmlFor="x" />
    {/* @ts-expect-error acceptCharset → accept-charset */}
    <div acceptCharset="x" />
    {/* @ts-expect-error httpEquiv → http-equiv */}
    <div httpEquiv="x" />
    {/* @ts-expect-error readOnly → readonly */}
    <div readOnly="x" />
    {/* @ts-expect-error noValidate → novalidate */}
    <div noValidate="x" />
    {/* @ts-expect-error formNoValidate → formnovalidate */}
    <div formNoValidate="x" />
    {/* @ts-expect-error autoFocus → autofocus */}
    <div autoFocus="x" />
    {/* @ts-expect-error autoPlay → autoplay */}
    <div autoPlay="x" />
    {/* @ts-expect-error playsInline → playsinline */}
    <div playsInline="x" />
    {/* @ts-expect-error allowFullScreen → allowfullscreen */}
    <div allowFullScreen="x" />
    {/* @ts-expect-error isMap → ismap */}
    <div isMap="x" />
    {/* @ts-expect-error noModule → nomodule */}
    <div noModule="x" />
  </>
);

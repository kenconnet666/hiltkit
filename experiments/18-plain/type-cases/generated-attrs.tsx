// 由 scripts/gen-attr-cases.mjs 从运行时的规则表（03-publish/packages/runtime/rules.js）生成，不要手改。
export const Generated = (
  <>
    {/* BOOL 属性：true / false / 读取函数；字符串不收（"false" 是真值，"" 在 JS 里是假值） */}
    <iframe allowfullscreen />
    <iframe allowfullscreen={false} />
    <iframe allowfullscreen={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <iframe allowfullscreen="false" />
    <script async />
    <script async={false} />
    <script async={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <script async="false" />
    <div autofocus />
    <div autofocus={false} />
    <div autofocus={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <div autofocus="false" />
    <video autoplay />
    <video autoplay={false} />
    <video autoplay={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <video autoplay="false" />
    <video controls />
    <video controls={false} />
    <video controls={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <video controls="false" />
    <track default />
    <track default={false} />
    <track default={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <track default="false" />
    <script defer />
    <script defer={false} />
    <script defer={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <script defer="false" />
    <button disabled />
    <button disabled={false} />
    <button disabled={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <button disabled="false" />
    <button formnovalidate />
    <button formnovalidate={false} />
    <button formnovalidate={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <button formnovalidate="false" />
    <div hidden />
    <div hidden={false} />
    <div hidden={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <div hidden="false" />
    <div inert />
    <div inert={false} />
    <div inert={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <div inert="false" />
    <img ismap />
    <img ismap={false} />
    <img ismap={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <img ismap="false" />
    <div itemscope />
    <div itemscope={false} />
    <div itemscope={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <div itemscope="false" />
    <video loop />
    <video loop={false} />
    <video loop={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <video loop="false" />
    <input type="file" multiple />
    <input type="file" multiple={false} />
    <input type="file" multiple={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <input type="file" multiple="false" />
    <script nomodule />
    <script nomodule={false} />
    <script nomodule={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <script nomodule="false" />
    <form novalidate />
    <form novalidate={false} />
    <form novalidate={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <form novalidate="false" />
    <details open />
    <details open={false} />
    <details open={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <details open="false" />
    <video playsinline />
    <video playsinline={false} />
    <video playsinline={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <video playsinline="false" />
    <div popover />
    <div popover={false} />
    <div popover={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <div popover="false" />
    <input readonly />
    <input readonly={false} />
    <input readonly={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <input readonly="false" />
    <input required />
    <input required={false} />
    <input required={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <input required="false" />
    <ol reversed />
    <ol reversed={false} />
    <ol reversed={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <ol reversed="false" />
    <input type="file" webkitdirectory />
    <input type="file" webkitdirectory={false} />
    <input type="file" webkitdirectory={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <input type="file" webkitdirectory="false" />
    <video disablepictureinpicture />
    <video disablepictureinpicture={false} />
    <video disablepictureinpicture={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <video disablepictureinpicture="false" />
    <video disableremoteplayback />
    <video disableremoteplayback={false} />
    <video disableremoteplayback={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <video disableremoteplayback="false" />
    <input type="checkbox" checked />
    <input type="checkbox" checked={false} />
    <input type="checkbox" checked={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <input type="checkbox" checked="false" />
    <option selected />
    <option selected={false} />
    <option selected={() => true} />
    {/* @ts-expect-error "false" 是真值 */}
    <option selected="false" />
    <video muted />
    <video muted={false} />
    <video muted={() => true} />
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

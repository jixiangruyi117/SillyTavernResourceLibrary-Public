export function evaluateRenderCompatibilityAssertions({
  shortBox,
  viewport,
  viewportBox,
  viewportStyles,
  updatedViewportBox,
  updatedHostHeight,
  nativeViewportBox,
  nativeViewportStyles,
  fixedBox,
  apiResult,
  apiSwipeState,
  lifecycleAfterB,
  lifecycleAfterA,
  lifecycleSwipeHeights,
  canonicalSourceResume,
  canonicalBudgetResume,
  offscreenHeavy,
  heavyInitialSynchronousFormatterEvents,
  heavyOpening,
  heavyFirstCFormatterCount,
  heavyFinalCFormatterCount,
  heavyLoadedVendors,
  settledCarouselSamples,
  carouselHeightStability,
  navigationAfterClick,
  navigationTopUrlAfter,
  navigationTopUrlBefore,
  buildResult,
  productionPaths,
  productionEvidence,
  noMvuState,
  safeState,
  errors,
  horizontalOverflow,
  unexpectedErrors,
}) {
  return {
    shortContentDoesNotFillViewport: shortBox.height > 0 && shortBox.height < viewport.height / 2,
    mappedMinHeightVhUsesHostHeight:
      Math.abs(viewportBox.height - viewport.height) <= 2 &&
      Math.abs((viewportStyles.stylesheet?.minHeight || 0) - viewport.height) <= 2 &&
      Math.abs((viewportStyles.inline?.minHeight || 0) - viewport.height / 2) <= 2 &&
      Math.abs((viewportStyles.script?.minHeight || 0) - viewport.height / 4) <= 2 &&
      viewportStyles.srcdoc.includes('var(--TH-viewport-height)'),
    mappedMinHeightTracksHostViewportUpdate:
      Math.abs(updatedViewportBox.height - updatedHostHeight) <= 2,
    nativeHeightAndMaxHeightRemainIframeRelative:
      Math.abs(nativeViewportBox.height - 200) <= 2 &&
      Math.abs((nativeViewportStyles.height?.height || 0) - 100) <= 2 &&
      Math.abs((nativeViewportStyles.maxHeight?.height || 0) - 50) <= 2 &&
      nativeViewportStyles.height?.authoredStyle.includes('height:50vh') &&
      nativeViewportStyles.maxHeight?.authoredStyle.includes('max-height:25vh'),
    dynamicSmallLargeViewportUnitsRemainNative:
      Math.abs((nativeViewportStyles.dvh?.minHeight || 0) - 20) <= 2 &&
      Math.abs((nativeViewportStyles.svh?.minHeight || 0) - 20) <= 2 &&
      Math.abs((nativeViewportStyles.lvh?.minHeight || 0) - 20) <= 2 &&
      nativeViewportStyles.dvh?.authoredStyle.includes('10dvh') &&
      nativeViewportStyles.svh?.authoredStyle.includes('10svh') &&
      nativeViewportStyles.lvh?.authoredStyle.includes('10lvh') &&
      !nativeViewportStyles.srcdoc.includes('var(--TH-viewport-height)'),
    fixedViewportLayerUsesHostHeight: Math.abs(fixedBox.height - viewport.height) <= 2,
    apiSessionWorks:
      apiResult.error === '' &&
      apiSwipeState.swipeId === 1 &&
      apiSwipeState.dataHp === 20 &&
      apiSwipeState.mvuHp === 20 &&
      [
        'range',
        'negative',
        'filtered',
        'data',
        'variables',
        'script',
        'context',
        'globals',
        'errorCatched',
        'formatter',
        'mvu',
      ].every((key) => apiResult.state[key] === true),
    stablePreviewSessionSwipeLifecycle:
      lifecycleAfterB.bootCount === 1 &&
      lifecycleAfterB.swipeCount === 1 &&
      lifecycleAfterB.sameCompanion === true &&
      lifecycleAfterB.persistentGlobal === 'kept' &&
      lifecycleAfterB.persistentScript === 'kept' &&
      lifecycleAfterB.text === '开场 B' &&
      lifecycleAfterB.swipeId === 1 &&
      lifecycleAfterB.data === 'B' &&
      lifecycleAfterA.bootCount === 1 &&
      lifecycleAfterA.swipeCount === 2 &&
      lifecycleAfterA.sameCompanion === true &&
      lifecycleAfterA.persistentGlobal === 'kept' &&
      lifecycleAfterA.persistentScript === 'kept' &&
      lifecycleAfterA.text === '开场 A' &&
      lifecycleAfterA.swipeId === 0 &&
      lifecycleAfterA.data === 'A' &&
      lifecycleSwipeHeights.length > 0 &&
      lifecycleSwipeHeights.every((height) => height > 1),
    sourceToPreviewCanonicalResumeMountsVueAndStartsAtB:
      canonicalSourceResume.vueComponentMounted === true &&
      canonicalSourceResume.stableOuterSession === true &&
      canonicalSourceResume.resumedOuterMounts === 1 &&
      canonicalSourceResume.resumedFrontendMounts.a === 0 &&
      canonicalSourceResume.resumedFrontendMounts.b === 1 &&
      canonicalSourceResume.resumedTransitionSwipe === 0 &&
      canonicalSourceResume.resumedHostInitialGreetingIndex === 1 &&
      canonicalSourceResume.hostGreetingIndex === 1 &&
      canonicalSourceResume.currentOpening === '开场 B' &&
      canonicalSourceResume.elapsedToBFrontendReadyMs >= 0 &&
      canonicalSourceResume.errors.length === 0,
    previewBudgetCanonicalResumeMountsVueAndStartsAtB:
      canonicalBudgetResume.vueComponentMounted === true &&
      canonicalBudgetResume.stableOuterSession === true &&
      canonicalBudgetResume.resumedOuterMounts === 1 &&
      canonicalBudgetResume.resumedFrontendMounts.a === 0 &&
      canonicalBudgetResume.resumedFrontendMounts.b === 1 &&
      canonicalBudgetResume.resumedTransitionSwipe === 0 &&
      canonicalBudgetResume.resumedHostInitialGreetingIndex === 1 &&
      canonicalBudgetResume.hostGreetingIndex === 1 &&
      canonicalBudgetResume.currentOpening === '开场 B' &&
      canonicalBudgetResume.elapsedToBFrontendReadyMs >= 0 &&
      canonicalBudgetResume.errors.length === 0,
    offscreenHeavyPreviewDoesNoStartupWork:
      offscreenHeavy.formatterCount === 0 &&
      offscreenHeavy.vendorLoadCount === 0 &&
      offscreenHeavy.mvuParseCount === 0 &&
      offscreenHeavy.documentBuildCount === 0 &&
      offscreenHeavy.outerMounts === 0 &&
      JSON.stringify(offscreenHeavy.eventStages) === JSON.stringify(['component-created']),
    heavyOpeningFormatsCurrentSynchronouslyOnce:
      heavyInitialSynchronousFormatterEvents.length === 1 &&
      heavyInitialSynchronousFormatterEvents[0]?.greetingIndex === 1 &&
      heavyInitialSynchronousFormatterEvents[0]?.formatterKind === 'current' &&
      heavyOpening.initial.frontendMounts[1] === 1 &&
      heavyOpening.initial.frontendMounts
        .filter((_count, index) => ![0, 1, 2].includes(index))
        .every((count) => count === 0),
    heavyOpeningAlternateFormatterIsCached:
      heavyFirstCFormatterCount <= 1 &&
      heavyFinalCFormatterCount === heavyFirstCFormatterCount &&
      heavyOpening.final.companionBoots === 1 &&
      heavyOpening.final.swipeEvents === 3 &&
      heavyOpening.stableIdentity.outer === true &&
      heavyOpening.stableIdentity.companion === true,
    heavyOpeningPerformanceStagesRecorded:
      [
        'component-created',
        'preview-budget-active',
        'vendor-load',
        'mvu-parse',
        'formatter',
        'document-build',
        'iframe-load',
      ].every((stage) => heavyOpening.initial.events.some((event) => event.stage === stage)) &&
      heavyOpening.initial.frontendReadyAt[1]?.length === 1 &&
      heavyOpening.initial.events
        .filter((event) => event.durationMs !== undefined)
        .every((event) => event.durationMs >= 0),
    heavyOpeningLoadsCompatibilityVendorFloor: [
      'font-awesome',
      'jquery',
      'jquery-ui',
      'jquery-ui-touch-punch',
      'lodash',
      'showdown',
      'tailwind',
      'vue',
      'vue-router',
      'yaml-zod',
    ].every((name) => heavyLoadedVendors.includes(name)),
    staticCarouselHeightConverges:
      settledCarouselSamples.length >= 20 &&
      Object.values(carouselHeightStability).every((measurement) => measurement.stable),
    executableGreetingLinkPreventsDefaultAndSwitchesOpening:
      navigationAfterClick.click?.seen === true &&
      navigationAfterClick.click?.defaultPrevented === true &&
      navigationTopUrlAfter === navigationTopUrlBefore &&
      navigationAfterClick.swipeId === 1 &&
      navigationAfterClick.text === '开场 B',
    localVendorEnvironmentWorks:
      apiResult.error === '' &&
      ['vendors', 'fontAwesome', 'tailwind'].every((key) => apiResult.state[key] === true) &&
      apiResult.state.touchPunch === viewport.width <= 430 &&
      buildResult.api.hasExternalVendorScript === false,
    fixedVendorFloorAndOptionalDependencyClosureWorks:
      [
        'font-awesome',
        'jquery',
        'jquery-ui',
        'jquery-ui-touch-punch',
        'lodash',
        'showdown',
        'tailwind',
        'vue',
        'vue-router',
        'yaml-zod',
      ].every((name) => buildResult.vendorCases.pureVue.loaded.includes(name)) &&
      !buildResult.vendorCases.pureVue.loaded.includes('toastr') &&
      buildResult.vendorCases.draggable.needs.jquery === true &&
      buildResult.vendorCases.draggable.needs.jqueryUi === true &&
      buildResult.vendorCases.draggable.loaded.includes('jquery') &&
      buildResult.vendorCases.draggable.loaded.includes('jquery-ui') &&
      buildResult.vendorCases.fontAwesome.needs.fontAwesome === true &&
      buildResult.vendorCases.fontAwesome.loaded.includes('font-awesome'),
    productionDirectSrcdocPathWorks: ['api', 'noMvu', 'lifecycle', 'carousel', 'navigation'].every(
      (name) =>
        productionPaths[name]?.directSrcdoc === true &&
        productionPaths[name]?.initialSandbox.includes('allow-scripts') &&
        productionPaths[name]?.initialSandbox.includes('allow-same-origin') &&
        productionEvidence[name].hasSrcdoc === true &&
        productionEvidence[name].src === '' &&
        productionEvidence[name].finalSandbox.includes('allow-scripts') &&
        productionEvidence[name].finalSandbox.includes('allow-same-origin'),
    ),
    recognizedMvuIsDirectAndUnrecognizedMvuIsAbsent:
      apiResult.state.globals === true && noMvuState === 'true',
    safeModeBlocksAuthorScript: safeState.unsafe === '' && buildResult.safe.blockedScripts,
    safeModeBlocksRemoteAsset:
      safeState.hasRemoteImage &&
      buildResult.safe.blockedExternalAssets &&
      errors.some(
        (message) =>
          message.includes("Loading the image 'https://example.invalid/a.png' violates") &&
          message.includes('Content Security Policy'),
      ),
    diagnosticsAreStructured:
      buildResult.api.diagnostics.some(
        (item) =>
          item.capability === 'message.format' &&
          item.implementationStatus === 'PARTIAL' &&
          item.parityStatus === 'UNVERIFIED',
      ) &&
      buildResult.api.diagnostics.some(
        (item) =>
          item.capability === 'mvu.opening-preview' &&
          item.implementationStatus === 'PARTIAL' &&
          item.parityStatus === 'UNVERIFIED',
      ) &&
      buildResult.api.diagnostics.some(
        (item) =>
          item.capability === 'viewport.min-height.vh' &&
          item.implementationStatus === 'IMPLEMENTED' &&
          item.parityStatus === 'UNVERIFIED',
      ),
    noHorizontalOverflow: !horizontalOverflow,
    noUnexpectedConsoleErrors: unexpectedErrors.length === 0,
  }
}

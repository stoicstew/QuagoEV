#!/usr/bin/env python3
"""Deterministic dependency-free generator for the checked-in native Xcode project."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent.parent
project = root / 'QuagoEV.xcodeproj'
project.mkdir(exist_ok=True)
def ident(name): return hashlib.sha1(name.encode()).hexdigest()[:24].upper()
def quote(s): return json.dumps(str(s))
def array(values): return '(' + ', '.join(values) + (',' if values else '') + ')'
objects = {}
def add(name, body): objects[ident(name)] = body; return ident(name)
app_sources = sorted((root / 'QuagoEV').rglob('*.swift'))
app_resources = [root / 'QuagoEV/Resources/demo-snapshot.json']
assets = root / 'QuagoEV/Resources/Assets.xcassets'
if assets.exists(): app_resources.append(assets)
ui_sources = sorted((root / 'UITests').rglob('*.swift'))
refs=[]
for p in app_sources + app_resources + ui_sources + [root/'QuagoEV/Info.plist']:
    path = str(p.relative_to(root))
    kind = 'sourcecode.swift' if p.suffix=='.swift' else 'folder.assetcatalog' if p.suffix=='.xcassets' else 'text.plist.xml' if p.suffix=='.plist' else 'text.json'
    refs.append(add('ref:'+path, f'isa = PBXFileReference; lastKnownFileType = {kind}; path = {quote(path)}; sourceTree = "<group>";'))
    if p.suffix!='.plist': add('build:'+path, f'isa = PBXBuildFile; fileRef = {ident("ref:"+path)};')
app_product = add('app-product', 'isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = QuagoEV.app; sourceTree = BUILT_PRODUCTS_DIR;')
ui_product = add('ui-product', 'isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = QuagoEVUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR;')
products=add('products', f'isa = PBXGroup; children = {array([app_product,ui_product])}; name = Products; sourceTree = "<group>";')
main=add('main', f'isa = PBXGroup; children = {array(refs+[products])}; sourceTree = "<group>";')
def phase(name,kind,files): return add(name,f'isa = {kind}; buildActionMask = 2147483647; files = {array([ident("build:"+str(p.relative_to(root))) for p in files])}; runOnlyForDeploymentPostprocessing = 0;')
app_phases=[phase('app-sources','PBXSourcesBuildPhase',app_sources),phase('app-frameworks','PBXFrameworksBuildPhase',[]),phase('app-resources','PBXResourcesBuildPhase',app_resources)]
ui_phases=[phase('ui-sources','PBXSourcesBuildPhase',ui_sources),phase('ui-frameworks','PBXFrameworksBuildPhase',[]),phase('ui-resources','PBXResourcesBuildPhase',[])]
def configs(name,extra):
    result=[]
    for mode in ['Debug','Release']:
        settings={'CLANG_ENABLE_MODULES':'YES','SWIFT_VERSION':'5.0','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SDKROOT':'iphoneos','TARGETED_DEVICE_FAMILY':'1,2','CODE_SIGN_STYLE':'Automatic','SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O','DEBUG_INFORMATION_FORMAT':'dwarf' if mode=='Debug' else 'dwarf-with-dsym','ENABLE_TESTABILITY':'YES' if mode=='Debug' else 'NO','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if mode=='Debug' else '',**extra}
        body=' '.join(f'{k} = {quote(v)};' for k,v in settings.items())
        result.append(add(name+'-'+mode,f'isa = XCBuildConfiguration; buildSettings = {{ {body} }}; name = {mode};'))
    return add(name+'-configs',f'isa = XCConfigurationList; buildConfigurations = {array(result)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
proj_configs=configs('project',{})
app_configs=configs('app',{'PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':'com.quagoev.ios','INFOPLIST_FILE':'QuagoEV/Info.plist','MARKETING_VERSION':'2.0.0','CURRENT_PROJECT_VERSION':'1','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','LD_RUNPATH_SEARCH_PATHS':'$(inherited) @executable_path/Frameworks','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','SUPPORTS_MACCATALYST':'NO'})
ui_configs=configs('ui',{'PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':'com.quagoev.ios.uitests','GENERATE_INFOPLIST_FILE':'YES','TEST_TARGET_NAME':'QuagoEV','LD_RUNPATH_SEARCH_PATHS':'$(inherited) @executable_path/Frameworks @loader_path/Frameworks'})
proxy=add('proxy',f'isa = PBXContainerItemProxy; containerPortal = {ident("project")}; proxyType = 1; remoteGlobalIDString = {ident("app-target")}; remoteInfo = QuagoEV;')
dep=add('dependency',f'isa = PBXTargetDependency; target = {ident("app-target")}; targetProxy = {proxy};')
app=add('app-target',f'isa = PBXNativeTarget; buildConfigurationList = {app_configs}; buildPhases = {array(app_phases)}; buildRules = (); dependencies = (); name = QuagoEV; productName = QuagoEV; productReference = {app_product}; productType = "com.apple.product-type.application";')
ui=add('ui-target',f'isa = PBXNativeTarget; buildConfigurationList = {ui_configs}; buildPhases = {array(ui_phases)}; buildRules = (); dependencies = {array([dep])}; name = QuagoEVUITests; productName = QuagoEVUITests; productReference = {ui_product}; productType = "com.apple.product-type.bundle.ui-testing";')
add('project',f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2700; TargetAttributes = {{ {app} = {{ CreatedOnToolsVersion = 27.0; }}; {ui} = {{ CreatedOnToolsVersion = 27.0; TestTargetID = {app}; }}; }}; }}; buildConfigurationList = {proj_configs}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = {main}; productRefGroup = {products}; projectDirPath = ""; projectRoot = ""; targets = {array([app,ui])};')
text='// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'
text+='\n'.join(f'{key} = {{ {body} }};' for key,body in objects.items())
text+=f'\n}}; rootObject = {ident("project")}; }}\n'
(project/'project.pbxproj').write_text(text)
schemes=project/'xcshareddata/xcschemes'; schemes.mkdir(parents=True,exist_ok=True)
def buildable(target,name): return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="{name}" BlueprintName="{name.split(".")[0]}" ReferencedContainer="container:QuagoEV.xcodeproj"/>'
(schemes/'QuagoEV.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.7">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{buildable(app,'QuagoEV.app')}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{buildable(ui,'QuagoEVUITests.xctest')}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildable(app,'QuagoEV.app')}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildable(app,'QuagoEV.app')}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')
print(project)

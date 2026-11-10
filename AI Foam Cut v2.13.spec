# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['launcher.py'],
    pathex=[],
    binaries=[('C:/Users/manue/OneDrive/Desktop/260925_AI Foam Cut OSS/XFOIL/xfoil.exe', 'XFOIL')],
    datas=[('airfoil.js', '.'), ('app.js', '.'), ('ausschnitt.js', '.'), ('ausschnitt_gcode.js', '.'), ('ausschnitt_seg.js', '.'), ('bauanleitung.js', '.'), ('bibliothek.js', '.'), ('blockprep.js', '.'), ('cad.js', '.'), ('cadpdf.js', '.'), ('cockpit.js', '.'), ('compute.js', '.'), ('core.js', '.'), ('cutpanel.js', '.'), ('decals.js', '.'), ('decals_design.js', '.'), ('decals_lib.js', '.'), ('drehachse.js', '.'), ('dxf.js', '.'), ('dxfshapes.js', '.'), ('earcut.js', '.'), ('filesys.js', '.'), ('flugsim.js', '.'), ('flugzeug.js', '.'), ('flz.js', '.'), ('foildb.js', '.'), ('foilpolar.js', '.'), ('formenbau.js', '.'), ('fraese.js', '.'), ('gcode.js', '.'), ('gcodegen.js', '.'), ('gmfc.js', '.'), ('grbl.js', '.'), ('hotwire.js', '.'), ('hotwire_gcode.js', '.'), ('i18n.js', '.'), ('kernteile.js', '.'), ('kfm.js', '.'), ('laminat.js', '.'), ('materials.js', '.'), ('measure2d.js', '.'), ('meshedit.js', '.'), ('meshocc.js', '.'), ('meshsection.js', '.'), ('model3d.js', '.'), ('model3d_gcode.js', '.'), ('nasenleiste.js', '.'), ('neg3d.js', '.'), ('negholme.js', '.'), ('neglatte.js', '.'), ('neuralfoil.js', '.'), ('neuralfoil_data.js', '.'), ('occad_lib.js', '.'), ('occad_wasm.js', '.'), ('occt-import-js.js', '.'), ('occt_wasm.js', '.'), ('overview.js', '.'), ('overview_bg.js', '.'), ('pathpreview.js', '.'), ('pc2.js', '.'), ('pc2wing.js', '.'), ('profedit.js', '.'), ('profilfit.js', '.'), ('profpolare.js', '.'), ('ptedit.js', '.'), ('render.js', '.'), ('ribs.js', '.'), ('ribvergleich.js', '.'), ('rproForm.js', '.'), ('rproSchnitte.js', '.'), ('rproSpanten.js', '.'), ('rumpfpro.js', '.'), ('safety.js', '.'), ('schrift.js', '.'), ('schrift_fonts.js', '.'), ('schrift_gcode.js', '.'), ('servos.js', '.'), ('sidebar.js', '.'), ('sim3d.js', '.'), ('simmodel.js', '.'), ('spars.js', '.'), ('stege.js', '.'), ('stegh.js', '.'), ('stepexport.js', '.'), ('stlbody.js', '.'), ('stlpreview.js', '.'), ('stuetzrippen.js', '.'), ('sweeprot.js', '.'), ('tabmenu.js', '.'), ('theme.js', '.'), ('undo.js', '.'), ('viewcube.js', '.'), ('wing.js', '.'), ('wingexport.js', '.'), ('wingimport.js', '.'), ('wings.js', '.'), ('xflr5.js', '.'), ('AI Foam Cut.html', '.')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='AI Foam Cut v2.13',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['C:/Users/manue/OneDrive/Desktop/260925_AI Foam Cut OSS/icon/icon.ico'],
)

"""Higgsfield background-Blender assets for V24.57.
Stages: base (camera approval), detail, export. Default all for clean-file rebuild.
All four asset pivots remain at the origin; staged preview copies are not exported.
"""
import bpy, bmesh, math, os
from mathutils import Vector
STAGE=globals().get('VOID_DETAIL_STAGE','all')
OUT=globals().get('VOID_DETAIL_OUTPUT',os.path.abspath('docs/assets/models/esfera-interior.glb'))
BLEND=globals().get('VOID_DETAIL_BLEND',os.path.abspath('esfera-interior.blend'))

if STAGE in ['base','all']:
    if bpy.data.scenes.get('VOID_INTERIOR_STUDIO'):raise RuntimeError('Use a clean file for base/all')
    scene=bpy.data.scenes.new('VOID_INTERIOR_STUDIO');bpy.context.window.scene=scene
    assets=bpy.data.collections.new('VOID_INTERIOR_ASSETS');scene.collection.children.link(assets);assets.hide_render=True
    preview=bpy.data.collections.new('VOID_INTERIOR_PREVIEW');scene.collection.children.link(preview)
    scene.render.engine='CYCLES';scene.cycles.samples=16;scene.render.resolution_x=1000;scene.render.resolution_y=800;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=0
    scene.world=bpy.data.worlds.new('VOID_DETAIL_WORLD');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.1,.15,.2,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.35
    scene.frame_start=1;scene.frame_end=144;scene.render.fps=24
else:
    scene=bpy.data.scenes['VOID_INTERIOR_STUDIO'];bpy.context.window.scene=scene
    assets=bpy.data.collections['VOID_INTERIOR_ASSETS'];preview=bpy.data.collections['VOID_INTERIOR_PREVIEW']

def material(name,color,metal=.7,rough=.35,emission=0):
    if bpy.data.materials.get(name):return bpy.data.materials[name]
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    return m
steel=material('VD_STEEL',(.12,.17,.22),.78,.36)
edge=material('VD_EDGES',(.36,.43,.48),.85,.27)
dark=material('VD_RECESS',(.013,.02,.027),.35,.6)
brass=material('VD_BRASS',(.38,.245,.085),.75,.4)
cyan=material('VD_CYAN',(.018,.55,.66),.25,.3,1.5)
amber=material('VD_AMBER',(.95,.35,.025),.2,.35,1.4)

def root(name):
    o=bpy.data.objects.new(name,None);assets.objects.link(o);return o
def mesh(name,vs,faces,mat,parent):
    data=bpy.data.meshes.new(name+'_MESH');data.from_pydata(vs,[],faces);data.materials.append(mat)
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free();data.update()
    o=bpy.data.objects.new(name,data);assets.objects.link(o);o.parent=parent;return o
def loft(name,sections,mat,parent,axis='z'):
    vs=[];faces=[];n=len(sections[0][1])
    for at,points in sections:
        for a,b in points:vs.append((at,a,b) if axis=='x' else (a,at,b) if axis=='y' else (a,b,at))
    faces.append(tuple(reversed(range(n))))
    for k in range(len(sections)-1):
        for j in range(n):faces.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
    faces.append(tuple((len(sections)-1)*n+j for j in range(n)))
    return mesh(name,vs,faces,mat,parent)
def rect(x0,x1,y0,y1,c=.5):return [(x0+c,y0),(x1-c,y0),(x1,y0+c),(x1,y1-c),(x1-c,y1),(x0+c,y1),(x0,y1-c),(x0,y0+c)]
def plate(name,x0,x1,y0,y1,z,h,mat,parent,c=.5):return loft(name,[(z,rect(x0,x1,y0,y1,c)),(z+h,rect(x0+.2,x1-.2,y0+.2,y1-.2,max(.1,c-.2)))],mat,parent)
def circle(r,n=12):return [(math.cos(i*math.tau/n)*r,math.sin(i*math.tau/n)*r) for i in range(n)]
foot=[(0,-12),(8,-8),(9,0),(8,8),(0,12),(-8,8),(-9,0),(-8,-8)]

if STAGE in ['base','all']:
    wall=root('VOID_DETAIL_WALL');base=root('VOID_DETAIL_TURRET_BASE');head=root('VOID_DETAIL_TURRET_HEAD');gate=root('VOID_DETAIL_GATE_PYLON')
    profile=[(-12,-50),(12,-50),(12,18),(9,24),(4,24),(4,21),(-4,21),(-4,24),(-9,24),(-12,18)]
    loft('VD_WALL_BODY',[(-20,profile),(20,profile)],steel,wall,'x')
    loft('VD_BASE_BODY',[(0,circle(9.6)),(2,circle(10.8)),(7,circle(10.8)),(10,circle(8.2))],steel,base)
    # Continuous stepped gun housing, with the narrower shoulders supporting barrels.
    loft('VD_HEAD_BODY',[(-8,rect(-7.8,7.8,0,7,1.4)),(-4,rect(-8,8,0,8,1.5)),(5,rect(-7,7,1,8,1.2)),(10,rect(-5.5,5.5,2,7,1))],steel,head,'y')
    foot=[(0,-12),(8,-8),(9,0),(8,8),(0,12),(-8,8),(-9,0),(-8,-8)]
    neck=[(0,-10),(7,-7),(8,0),(7,7),(0,10),(-7,7),(-8,0),(-7,-7)]
    loft('VD_GATE_BODY',[(-50,foot),(15,foot),(21,neck),(54,neck),(60,[(x*.8,y*.8) for x,y in neck])],steel,gate)
    data=bpy.data.cameras.new('VD_CAMERA');cam=bpy.data.objects.new('VD_CAMERA',data);preview.objects.link(cam)
    cam.location=(110,140,140);cam.rotation_euler=(Vector((0,0,-8))-cam.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=160;data.clip_end=1000;scene.camera=cam
    for name,loc,energy,size,color in [('VD_KEY',(-70,-25,150),700000,120,(.68,.83,1)),('VD_FILL',(80,110,100),210000,110,(1,.86,.66))]:
        d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;d.color=color
        o=bpy.data.objects.new(name,d);preview.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,-8))-o.location).to_track_quat('-Z','Y').to_euler()
        o['purpose']='Metal edge structure' if name=='VD_KEY' else 'Recover recessed bores without flattening'
else:
    wall=bpy.data.objects['VOID_DETAIL_WALL'];base=bpy.data.objects['VOID_DETAIL_TURRET_BASE'];head=bpy.data.objects['VOID_DETAIL_TURRET_HEAD'];gate=bpy.data.objects['VOID_DETAIL_GATE_PYLON']

def copy_preview():
    for o in list(preview.objects):
        if o.name.startswith('VD_PREVIEW_'):bpy.data.objects.remove(o,do_unlink=True)
    def copy_tree(o,parent,offset):
        c=o.copy();c.animation_data_clear();c.name='VD_PREVIEW_'+o.name;preview.objects.link(c);c.parent=parent
        if parent is None:c.location=offset
        for child in o.children:copy_tree(child,c,(0,0,0))
        return c
    copy_tree(wall,None,(-25,-24,0));copy_tree(gate,None,(35,-12,0));copy_tree(base,None,(-8,35,-50));copy_tree(head,None,(-8,35,-40))

if STAGE in ['detail','all']:
    # The light strip sits in the authored recessed channel, below the raised lips.
    plate('VD_WALL_CHANNEL',-18,18,-2.3,2.3,21.1,.3,cyan,wall,.3)
    for side in [-1,1]:
        y0,y1=(4.7,8.8) if side>0 else (-8.8,-4.7)
        for j,(x0,x1) in enumerate([(-18.5,-1.1),(1.1,18.5)]):
            plate('VD_WALL_ARMOR_'+str(side)+'_'+str(j),x0,x1,y0,y1,24,.8,edge,wall,.65)
        # Contrasting brackets and inlaid gold routing strips, sparse enough to read.
        plate('VD_WALL_ROUTE_'+str(side),-15,15,side*10-.4,side*10+.4,22.5,.4,brass,wall,.15)
    for x in [-17,17]:
        plate('VD_WALL_JOINT_'+str(x),x-.8,x+.8,-3.8,3.8,21.3,.65,dark,wall,.2)
    loft('VD_BASE_RING',[(5.5,circle(10.9)),(7,circle(10.9))],edge,base)
    loft('VD_BASE_PIVOT',[(8.8,circle(6)),(10,circle(6))],brass,base)
    for x in [-4,4]:
        # Hollow muzzle is a true bore, not a black disc pasted onto a solid tip.
        vs=[];faces=[];n=8
        for y,r in [(7,2.35),(21,2.35),(24,2),(24,1.2),(21,1.2)]:
            vs.extend((x+math.cos(i*math.tau/n)*r,y,4.5+math.sin(i*math.tau/n)*r) for i in range(n))
        for k in range(4):
            for i in range(n):faces.append((k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i))
        faces.append(tuple(reversed(range(n))));faces.append(tuple(4*n+i for i in range(n)))
        mesh('VD_BARREL_'+str(x),vs,faces,edge,head)
        # Recess depth is visible from the preview camera, with an unlit rear bore.
        mesh('VD_BORE_'+str(x),[(x+math.cos(i*math.tau/n)*1.18,21.05,4.5+math.sin(i*math.tau/n)*1.18) for i in range(n)],[tuple(range(n))],dark,head)
    plate('VD_HEAD_ROOF',-5,5,-5,4,8,.5,edge,head,.7)
    plate('VD_HEAD_SIGNAL',-3,3,-3,0,8.55,.2,amber,head,.3)
    for x in [-6.5,6.5]:plate('VD_HEAD_RAIL_'+str(x),x-.5,x+.5,-2,7,7.4,.4,brass,head,.2)
    # Tall entrance frame with open-side pistons, inset amber warning plaques,
    # machined collars and a bright cap. It never spans the passage.
    for z in [-42,8,22,46]:
        loft('VD_GATE_COLLAR_'+str(z),[(z,[(x*.98,y*.98) for x,y in foot]),(z+2,[(x*.98,y*.98) for x,y in foot])],edge,gate)
    for side in [-1,1]:
        profile=[(-1.2,0),(1.2,0),(1.2,29),(.6,31),(-.6,31),(-1.2,29)]
        o=loft('VD_GATE_PISTON_'+str(side),[(-1.5,profile),(1.5,profile)],brass,gate,'x');o.location=(0,side*9.4,24)
    plate('VD_GATE_CAP',-5.5,5.5,-6,6,60.1,.8,cyan,gate,.9)
    plate('VD_GATE_WARNING',-3.5,3.5,-4,0,61,.4,amber,gate,.5)
    leaf=material('VD_LEAF',(.21,.29,.34),.8,.34)
    loft('VD_GATE_SHUTTER',[(24,rect(-3.5,3.5,9.8,11.3,.4)),(50,rect(-3.5,3.5,9.8,11.3,.4)),(54,rect(-2.8,2.8,9.8,11.1,.3))],leaf,gate)
    # Collapse repeated static detail by material, preserving the four moving roots.
    for parent in [wall,base,head,gate]:
        groups={}
        for o in list(parent.children):
            if o.type=='MESH':groups.setdefault(o.data.materials[0],[]).append(o)
        for group in groups.values():
            if len(group)<2:continue
            bpy.ops.object.select_all(action='DESELECT')
            for o in group:o.select_set(True)
            bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join()

if STAGE in ['base','detail','all']:copy_preview()
if STAGE in ['export','all']:
    os.makedirs(os.path.dirname(OUT),exist_ok=True);os.makedirs(os.path.dirname(BLEND),exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    bpy.ops.object.select_all(action='DESELECT')
    for o in assets.objects:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT,export_format='GLB',use_selection=True,use_active_scene=True,export_animations=False,export_cameras=False,export_lights=False,export_apply=True)
result={'stage':STAGE,'scene':scene.name,'asset_meshes':len([o for o in assets.objects if o.type=='MESH']),'triangles':sum(len(p.vertices)-2 for o in assets.objects if o.type=='MESH' for p in o.data.polygons),'roots':[o.name for o in assets.objects if not o.parent],'export':OUT if STAGE in ['export','all'] else None}

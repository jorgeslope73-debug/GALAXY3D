"""Original local Blender model; no external textures or generated assets.
Run in Blender with VOID_OUTPUT_DIR set to the game's docs/assets/models.
Dynamic gates/core/roof remain separate semantic nodes for the game.
"""
import bpy, math, os
from mathutils import Vector

OUT = globals().get('VOID_OUTPUT_DIR', os.path.abspath('docs/assets/models'))
os.makedirs(OUT, exist_ok=True)
if bpy.data.scenes.get('VOID_STATION'):
    raise RuntimeError('VOID_STATION already exists; use a clean background Blender file')
scene = bpy.data.scenes.new('VOID_STATION')
bpy.context.window.scene = scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x = 1000
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.world = bpy.data.worlds.new('VOID_WORLD')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.12,.17,.24,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = .45
scene.frame_start = 1
scene.frame_end = 144
scene.render.fps = 24
collection = bpy.data.collections.new('VOID_ASSET')
scene.collection.children.link(collection)
root = bpy.data.objects.new('VOID_ROOT', None)
collection.objects.link(root)

def material(name, color, metal=.65, rough=.38, emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    return m

steel=material('VOID_TITANIUM',(.105,.155,.205))
edge=material('VOID_EDGE',(.29,.39,.47),.8,.3)
floor=material('VOID_FLOOR',(.025,.045,.065),.35,.62)
cyan=material('VOID_CYAN',(.04,.74,.85),.3,.3,2)
orange=material('VOID_ORANGE',(.95,.25,.035),.3,.35,2)
violet=material('VOID_VIOLET',(.36,.055,.82),.3,.28,2)

def mesh(name,vertices,faces,mats,indices=None,parent=root):
    data=bpy.data.meshes.new(name+'_MESH');data.from_pydata(vertices,[],faces);data.update()
    o=bpy.data.objects.new(name,data);collection.objects.link(o);o.parent=parent
    for m in mats:data.materials.append(m)
    if indices:
        for p,i in zip(data.polygons,indices):p.material_index=i
    return o

def polar(r,a,z):return (math.cos(a)*r,math.sin(a)*r,z)
def ring(name,r,width,steps,portal,half,gate=False):
    vs=[];fs=[];ids=[]
    for i in range(steps):
        a=i*math.tau/steps;b=(i+1)*math.tau/steps;mid=(a+b)*.5
        is_gate=abs(math.atan2(math.sin(mid-portal),math.cos(mid-portal)))<half
        if is_gate!=gate:continue
        # Chamfered stepped section: structural wall, inset luminous trench.
        profile=[(r-width,-50),(r+width,-50),(r+width,12),(r+width-4,20),(r-width+4,20),(r-width,12)]
        base=len(vs)
        for t in [a,b]:vs.extend(polar(rad,t,z) for rad,z in profile)
        n=len(profile)
        for j in range(n):fs.append((base+j,base+(j+1)%n,base+n+(j+1)%n,base+n+j));ids.append(1 if j in [2,4] else 0)
        fs.extend([tuple(base+j for j in reversed(range(n))),tuple(base+n+j for j in range(n))]);ids.extend([0,0])
        # Recessed top strip, below the edge lips, never a floating plate.
        q=len(vs);gap=.006
        vs.extend([polar(r-3,a+gap,19.4),polar(r+3,a+gap,19.4),polar(r+3,b-gap,19.4),polar(r-3,b-gap,19.4)])
        fs.append((q,q+1,q+2,q+3));ids.append(2)
    return mesh(name,vs,fs,[steel,edge,orange if gate else cyan],ids)

outer=ring('VOID_OUTER_WALL',410,12,72,math.pi,math.radians(20))
inner=ring('VOID_INNER_WALL',235,12,48,0,math.radians(30))
outer_gate=ring('VOID_OUTER_GATE',410,12,72,math.pi,math.radians(20),True)
inner_gate=ring('VOID_INNER_GATE',235,12,48,0,math.radians(30),True)

def annulus(name,r0,r1,z,steps=72):
    vs=[];faces=[]
    for i in range(steps):
        a=i*math.tau/steps;b=(i+1)*math.tau/steps;k=len(vs)
        vs.extend([polar(r0,a,z),polar(r1,a,z),polar(r1,b,z),polar(r0,b,z)]);faces.append((k,k+1,k+2,k+3))
    return mesh(name,vs,faces,[floor])

annulus('VOID_CORRIDOR',248,397,-54)
annulus('VOID_CHAMBER',0,222,-54,48)

def sphere_mesh(name,r,mat,parent=root,location=(0,0,0),rings=8,steps=24):
    vs=[];faces=[]
    for j in range(rings+1):
        phi=math.pi*j/rings
        for i in range(steps):
            t=math.tau*i/steps;vs.append((r*math.sin(phi)*math.cos(t),r*math.sin(phi)*math.sin(t),r*math.cos(phi)))
    for j in range(rings):
        for i in range(steps):faces.append((j*steps+i,j*steps+(i+1)%steps,(j+1)*steps+(i+1)%steps,(j+1)*steps+i))
    o=mesh(name,vs,faces,[mat],parent=parent);o.location=location;return o

core=sphere_mesh('VOID_CORE',65,violet,rings=6,steps=16)
for slot,a in enumerate([math.pi,-math.pi/3,math.pi/3]):
    # Game Y is inverted in the renderer; author the negative game Y in Blender.
    loc=(470*math.cos(a),-470*math.sin(a),0)
    g=sphere_mesh('VOID_GENERATOR_'+str(slot),24,orange,location=loc,rings=4,steps=8)

# Curved hemisphere of separate armor panels; runtime cutaway fades this shell.
vs=[];faces=[];ids=[]
for j in range(6):
    p0=j*(math.pi/2)/6+.015;p1=(j+1)*(math.pi/2)/6-.015
    for i in range(36):
        a=i*math.tau/36+.012;b=(i+1)*math.tau/36-.012;k=len(vs)
        for p,t in [(p0,a),(p1,a),(p1,b),(p0,b)]:vs.append((407*math.sin(p)*math.cos(t),407*math.sin(p)*math.sin(t),205*math.cos(p)))
        faces.append((k,k+1,k+2,k+3));ids.append(1 if (i+j)%7==0 else 0)
roof=mesh('VOID_ROOF',vs,faces,[steel,edge],ids)

# Keep roof lower hemisphere out of the flight plane. This rounded underside
# supplies a spherical silhouette without invisible obstructions to the pilot.
vs=[];faces=[]
for j in range(5):
    p0=j*math.pi/10;p1=(j+1)*math.pi/10
    for i in range(36):
        a=i*math.tau/36;b=(i+1)*math.tau/36;k=len(vs)
        for p,t in [(p0,a),(p1,a),(p1,b),(p0,b)]:vs.append((407*math.sin(p)*math.cos(t),407*math.sin(p)*math.sin(t),-55-170*math.cos(p)))
        faces.append(tuple(k+n for n in reversed(range(4))))
mesh('VOID_UNDERSIDE',vs,faces,[steel])

for i,sign in enumerate([-1,1]):
    turret=sphere_mesh('VOID_TURRET_'+str(i),18,edge,location=(0,-sign*315,-5),rings=4,steps=8)
    # Elongated tapered housing keeps the silhouette distinct from a bare ball.
    turret.scale=(1,1,.6)

camera_data=bpy.data.cameras.new('VOID_CAMERA');camera=bpy.data.objects.new('VOID_CAMERA',camera_data);scene.collection.objects.link(camera)
camera.location=(0,-650,1400);camera.rotation_euler=(Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.clip_end=5000;camera_data.type='ORTHO';camera_data.ortho_scale=1120;scene.camera=camera
for name,loc,energy,size,color in [('VOID_KEY',(-500,-350,950),1600000,700,(.73,.87,1)),('VOID_FILL',(500,200,650),600000,850,(.4,.55,1))]:
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;data.color=color
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
    o['purpose']='Form and readable dark-metal reflections' if 'KEY' in name else 'Recover corridor shadow detail'

# Preview a traversable cutaway. Runtime controls these same pivots from state.
roof.hide_render=True
outer_gate.location.z=-95
inner_gate.location.z=-95
core.rotation_euler.z=0;core.keyframe_insert('rotation_euler',frame=1)
core.rotation_euler.z=math.tau;core.keyframe_insert('rotation_euler',frame=145)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'esfera-vacio.blend'))
result={'scene':scene.name,'objects':len(collection.objects),'triangles':sum(len(p.vertices)-2 for o in collection.objects if o.type=='MESH' for p in o.data.polygons),'blend':os.path.join(OUT,'esfera-vacio.blend')}

# Camera-read refinement and final export.
"""Second pass after the cutaway camera check: structural accents and export."""
import bpy, math, os
from mathutils import Vector
scene=bpy.context.scene;collection=bpy.data.collections['VOID_ASSET'];root=bpy.data.objects['VOID_ROOT']
steel=bpy.data.materials['VOID_TITANIUM'];edge=bpy.data.materials['VOID_EDGE'];cyan=bpy.data.materials['VOID_CYAN'];orange=bpy.data.materials['VOID_ORANGE'];violet=bpy.data.materials['VOID_VIOLET']
for name in ['VOID_OUTER_WALL','VOID_INNER_WALL','VOID_OUTER_GATE','VOID_INNER_GATE']:
    mesh=bpy.data.objects[name].data
    for p in mesh.polygons:
        if p.material_index!=2:p.flip()
    mesh.update()

def add_mesh(name,vs,faces,mat,parent=root):
    mesh=bpy.data.meshes.new(name+'_MESH');mesh.from_pydata(vs,[],faces);mesh.materials.append(mat);mesh.update()
    o=bpy.data.objects.new(name,mesh);collection.objects.link(o);o.parent=parent;return o

def band(name,r,width,z,mat,parent=root,steps=64):
    vs=[];faces=[]
    for i in range(steps):
        a=i*math.tau/steps;b=(i+1)*math.tau/steps;k=len(vs)
        vs.extend([(math.cos(t)*rr,math.sin(t)*rr,z) for rr,t in [(r-width,a),(r+width,a),(r+width,b),(r-width,b)]])
        faces.append((k,k+1,k+2,k+3))
    return add_mesh(name,vs,faces,mat,parent)

# Recessed radial deck markings, entirely below the flight plane.
vs=[];faces=[]
for i in range(48):
    a=i*math.tau/48;k=len(vs)
    for r,t in [(257,a-.002),(386,a-.002),(386,a+.002),(257,a+.002)]:vs.append((math.cos(t)*r,math.sin(t)*r,-53.5))
    faces.append((k,k+1,k+2,k+3))
add_mesh('VOID_DECK_SEAMS',vs,faces,edge)
band('VOID_NAVIGATION',320,1.8,-53,cyan)
band('VOID_REACTOR_SEAT',84,7,-44,edge)
band('VOID_REACTOR_HALO',76,2,-42,violet)
for slot in range(3):
    g=bpy.data.objects['VOID_GENERATOR_'+str(slot)]
    # The orange mesh is inset inside a substantial chamfered casing.
    g.scale=(.68,.68,.85)
    collar=band('VOID_GENERATOR_COLLAR_'+str(slot),23,6,0,edge,parent=g,steps=12)
    collar.scale=(1/.68,1/.68,1/.85)
    for i in range(4):
        t=i*math.tau/4
        marker=band('VOID_GEN_LIGHT_'+str(slot)+'_'+str(i),18,1.5,13,orange,parent=g,steps=12)
        # One continuous collar is enough; shared material batching happens below.
        break
for i in range(2):
    turret=bpy.data.objects['VOID_TURRET_'+str(i)]
    vs=[(-5,0,2),(5,0,2),(5,32,2),(-5,32,2),(-4,0,10),(4,0,10),(4,32,10),(-4,32,10)]
    add_mesh('VOID_TURRET_BARREL_'+str(i),vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],edge,parent=turret)
core=bpy.data.objects['VOID_CORE']
band('VOID_CORE_EQUATOR',69,5,0,edge,parent=core,steps=32)
band('VOID_CORE_TOP',46,4,48,edge,parent=core,steps=24)
band('VOID_CORE_BOTTOM',46,4,-48,edge,parent=core,steps=24)

# Combine decorative children by semantic moving parent/material, not moving parts.
for parent in [root,core]+[bpy.data.objects['VOID_GENERATOR_'+str(i)] for i in range(3)]:
    candidates=[o for o in list(parent.children) if o.type=='MESH' and any(x in o.name for x in ['COLLAR','LIGHT','EQUATOR','CORE_TOP','CORE_BOTTOM','DECK_SEAMS','NAVIGATION','REACTOR_SEAT','REACTOR_HALO'])]
    groups={}
    for o in candidates:groups.setdefault(o.data.materials[0],[]).append(o)
    for group in groups.values():
        if len(group)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:o.select_set(True)
        bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join()

scene.camera.data.clip_end=5000
out=globals().get('VOID_OUTPUT_DIR',os.path.abspath('docs/assets/models'))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'esfera-vacio.blend'))
# Export rest poses; the GLB has no expensive baked animation. Game owns motion.
roof=bpy.data.objects['VOID_ROOF'];roof.hide_render=False
for name in ['VOID_OUTER_GATE','VOID_INNER_GATE']:bpy.data.objects[name].location.z=0
core.animation_data_clear();core.rotation_euler.z=0
bpy.ops.object.select_all(action='DESELECT')
for o in collection.objects:o.select_set(True)
path=globals().get('VOID_GLB_PATH',os.path.join(out,'esfera-vacio.glb'))
bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,use_active_scene=True,export_animations=False,export_cameras=False,export_lights=False,export_apply=True)
roof.hide_render=True
for name in ['VOID_OUTER_GATE','VOID_INNER_GATE']:bpy.data.objects[name].location.z=-95
result={'glb':path,'bytes':os.path.getsize(path),'triangles':sum(len(p.vertices)-2 for o in collection.objects if o.type=='MESH' for p in o.data.polygons),'objects':len(collection.objects)}

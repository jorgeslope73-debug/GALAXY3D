"""Editable low-poly GLB source. Run in a fresh background Blender process.

Templates face +X in Blender XY. Runtime applies glTF's axis conversion once.
No external textures; five shared PBR materials; semantic jaw pivots survive export.
"""
import bpy, math, os
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parents[1] / 'outputs'
OUT.mkdir(exist_ok=True)

def material(name, color, metallic=0, rough=.4, emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metallic;bs.inputs['Roughness'].default_value=rough
    if emission:
        bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=emission
    return m

def empty(name,parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.scene.collection.objects.link(o);o.parent=parent;return o

def mesh(name,vertices,faces,mat,parent):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.materials.append(mat);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(o);o.parent=parent;return o

def loft(name,stations,mat,parent,sides=8):
    vertices=[(x,math.cos((i+.5)*math.tau/sides)*ry,math.sin((i+.5)*math.tau/sides)*rz) for x,ry,rz in stations for i in range(sides)]
    faces=[tuple(reversed(range(sides)))]
    for j in range(len(stations)-1):
        for i in range(sides):faces.append((j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i))
    faces.append(tuple((len(stations)-1)*sides+i for i in range(sides)))
    return mesh(name,vertices,faces,mat,parent)

def wedge(name,profile,depth,mat,parent):
    verts=[(x,y,z) for z in [-depth/2,depth/2] for x,y in profile];n=len(profile)
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,verts,faces,mat,parent)

def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()

def preview_chain(segment,joint):
    for i in range(1,5):
        root=empty('PREVIEW_SEGMENT_'+str(i));root.location=(.75-i*1.65,.7*math.sin(i*.65),-.04*i)
        root.rotation_euler.z=-.18*math.cos(i*.65)
        for child in segment.children:
            clone=child.copy();clone.data=child.data;bpy.context.scene.collection.objects.link(clone);clone.parent=root
        link=empty('PREVIEW_JOINT_'+str(i));link.location=(root.location.x+.8,root.location.y-.1,root.location.z)
        for child in joint.children:
            clone=child.copy();clone.data=child.data;bpy.context.scene.collection.objects.link(clone);clone.parent=link

def blockout():
    if bpy.data.scenes.get('DEVORADOR_GAME_ASSET'):
        raise RuntimeError('Use a fresh Blender process; the authored scene already exists.')
    scene=bpy.data.scenes.new('DEVORADOR_GAME_ASSET');bpy.context.window.scene=scene
    scene['passport']='PHASE 4 / 5 SEGMENTS / DARK OCTAGONAL ARMOR / ORANGE JOINTS / 3 JAWS / GAME TOP VIEW / SHARED MESHES / TARGET <6000 TRIANGLES'
    mats={
        'armor':material('DEV_Armor',(0.085,.115,.16),.72,.33),
        'edge':material('DEV_Edges',(.27,.34,.42),.8,.27),
        'black':material('DEV_Recess',(.012,.018,.028),.3,.6),
        'orange':material('DEV_Energy',(1,.17,.018),.2,.3,2.2),
        'hazard':material('DEV_Hazard',(.95,.46,.045),.45,.38)
    }
    head=empty('DEVOURER_HEAD');head.location=(3.3,0,0)
    shell=loft('DEV_HEAD_ARMOR',[(-.85,.48,.37),(-.56,.78,.57),(.18,.81,.56),(.52,.65,.47)],mats['armor'],head)
    shell.data.materials.append(mats['edge'])
    for p in shell.data.polygons:
        if p.index%8 in [1,5]:p.material_index=1
    loft('DEV_MOUTH_RECESS',[(.52,.58,.43),(.57,.55,.41)],mats['black'],head)
    reactor=loft('DEV_REACTOR',[(.58,.26,.26),(.63,.31,.31),(.69,.22,.22)],mats['orange'],head,sides=12)
    for i in range(3):
        radial=empty('DEV_JAW_RADIAL_'+str(i),head);radial.rotation_euler.x=i*math.tau/3
        pivot=empty('JAW_'+str(i),radial);pivot.location=(.06,.25,0)
        wedge('DEV_JAW_ARMOR_'+str(i),[(-.28,.28),(.35,.47),(1.14,.15),(.78,.04),(.12,.11)],.29,mats['armor'],pivot)
    segment=empty('DEVOURER_SEGMENT');segment.location=(.75,0,0)
    seg=loft('DEV_SEGMENT_ARMOR',[(-.58,.30,.28),(-.41,.60,.43),(.24,.59,.43),(.55,.36,.29)],mats['armor'],segment)
    seg.data.materials.append(mats['edge'])
    for p in seg.data.polygons:
        if p.index%8 in [1,5]:p.material_index=1
    joint=empty('DEVOURER_JOINT');joint.location=(2.05,0,0)
    loft('DEV_JOINT_ENERGY',[(-.26,.23,.23),(-.13,.30,.30),(.13,.30,.30),(.26,.23,.23)],mats['orange'],joint,sides=10)
    preview_chain(segment,joint)
    scene['stage']='BLOCKOUT';scene['review']='PENDING TOP/THREE-QUARTER CAMERA READ'
    world=bpy.data.worlds.new('DEV_PREVIEW_WORLD');world.use_nodes=True
    world.node_tree.nodes.get('Background').inputs[0].default_value=(.015,.025,.05,1)
    world.node_tree.nodes.get('Background').inputs[1].default_value=.35;scene.world=world
    data=bpy.data.cameras.new('DEV_CAMERA');camera=bpy.data.objects.new('DEV_CAMERA',data);scene.collection.objects.link(camera)
    camera.location=(-2,-9,17);aim(camera,(-1.3,0,0));data.type='ORTHO';data.ortho_scale=14.5;scene.camera=camera
    for name,loc,power,size,color in [('KEY',(-1,-4,9),1700,8,(.65,.8,1)),('RIM',(3,5,6),1300,6,(1,.37,.10))]:
        data=bpy.data.lights.new('DEV_'+name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
        light=bpy.data.objects.new('DEV_'+name,data);scene.collection.objects.link(light);light.location=loc;aim(light,(-1,0,0))
        light['purpose']='ARMOR READ' if name=='KEY' else 'ORANGE EDGE SEPARATION'
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1100;scene.render.resolution_y=660;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.render.film_transparent=False
    return {'scene':scene.name,'roots':[head.name,segment.name,joint.name],'materials':len(mats),'stage':'blockout'}

def refine():
    scene=bpy.context.scene;head=bpy.data.objects['DEVOURER_HEAD'];segment=bpy.data.objects['DEVOURER_SEGMENT'];joint=bpy.data.objects['DEVOURER_JOINT']
    mats={key:bpy.data.materials[name] for key,name in [('armor','DEV_Armor'),('edge','DEV_Edges'),('black','DEV_Recess'),('orange','DEV_Energy'),('hazard','DEV_Hazard')]}
    # Swept fins and chamfered cutting edges reinforce the serpent silhouette.
    for root,scale in [(head,1),(segment,.72)]:
        fin=wedge('DEV_SPINE_'+root.name,[(-.6,.02),(-.45,.37),(.02,.74),(.24,.05)],.11,mats['edge'],root)
        fin.rotation_euler.x=math.pi/2;fin.location.z=.35*scale;fin.scale=(scale,scale,scale)
        for side in [-1,1]:
            plate=wedge('DEV_SIDE_FIN_'+root.name+str(side),[(-.65,.33),(-.62,.78),(-.12,.93),(.28,.40)],.12,mats['armor'],root)
            plate.scale=(scale,side*scale,scale);plate.location.z=.06
            stripe=wedge('DEV_HAZARD_'+root.name+str(side),[(-.43,.56),(-.38,.67),(-.11,.61),(-.16,.51)],.025,mats['hazard'],root)
            stripe.scale=(scale,side*scale,scale);stripe.location.z=.135
    for i in range(3):
        pivot=bpy.data.objects['JAW_'+str(i)]
        wedge('DEV_CUTTER_'+str(i),[(.18,.13),(.84,.055),(1.07,.15),(.53,.23)],.31,mats['edge'],pivot)
        wedge('DEV_JAW_GLOW_'+str(i),[(.23,.15),(.78,.09),(.9,.13),(.38,.20)],.325,mats['orange'],pivot)
        pivot.rotation_euler.z=.35
    # Small inset-like panels stay inside the octagonal armor's upper surface.
    for root in [head,segment]:
        for side in [-1,1]:
            panel=wedge('DEV_VENT_'+root.name+str(side),[(-.47,.16),(-.18,.21),(.06,.14),(-.22,.09)],.035,mats['black'],root)
            panel.location=(0,side*.18,.49 if root==head else .40)
    # Preview instances share all mesh data. Templates remain separate for articulation.
    for root in [o for o in scene.objects if o.name.startswith('PREVIEW_') and o.type=='EMPTY']:
        for obj in list(root.children_recursive):bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.objects.remove(root,do_unlink=True)
    preview_chain(segment,joint)
    return finalize()

def finalize():
    import bmesh
    scene=bpy.context.scene;head=bpy.data.objects['DEVOURER_HEAD'];segment=bpy.data.objects['DEVOURER_SEGMENT'];joint=bpy.data.objects['DEVOURER_JOINT']
    # Collapse static panels by semantic parent; keep the reactor/jaw pivots editable.
    for parent,name in [(head,'DEV_HEAD_ARMOR'),(segment,'DEV_SEGMENT_ARMOR')]+[(bpy.data.objects['JAW_'+str(i)],'DEV_JAW_ARMOR_'+str(i)) for i in range(3)]:
        children=[o for o in parent.children if o.type=='MESH' and o.name!='DEV_REACTOR']
        if len(children)<2:continue
        vertices=[];faces=[];indices=[];mats=[]
        for child in children:
            offset=len(vertices);matrix=child.matrix_local;reverse=matrix.determinant()<0
            vertices.extend([tuple(matrix@v.co) for v in child.data.vertices])
            for face in child.data.polygons:
                mat=child.data.materials[face.material_index]
                if mat not in mats:mats.append(mat)
                ids=[offset+i for i in face.vertices];faces.append(tuple(reversed(ids)) if reverse else tuple(ids));indices.append(mats.index(mat))
        for child in children:bpy.data.objects.remove(child,do_unlink=True)
        data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces)
        for mat in mats:data.materials.append(mat)
        for face,index in zip(data.polygons,indices):face.material_index=index
        obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.parent=parent
    for root in [o for o in scene.objects if o.name.startswith('PREVIEW_') and o.type=='EMPTY']:
        for obj in list(root.children_recursive):bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.objects.remove(root,do_unlink=True)
    preview_chain(segment,joint)
    for data in {o.data for o in scene.objects if o.type=='MESH'}:
        bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
    scene['stage']='FINAL';scene['review']='BLOCKOUT CONTINUE: HEAD/JAW PIVOTS, STEPPED SEGMENT ARMOR AND LUMINOUS CONNECTORS READ AT GAME SCALE'
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'devorador-lowpoly.blend'))
    bpy.ops.object.select_all(action='DESELECT')
    saved=[]
    for root in [head,segment,joint]:
        saved.append((root,root.location.copy()));root.location=(0,0,0)
        for obj in [root,*root.children_recursive]:obj.select_set(True)
    for i in range(3):bpy.data.objects['JAW_'+str(i)].rotation_euler.z=0
    target=ROOT/'docs/assets/models/devorador.glb'
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,use_active_scene=True,export_animations=False,export_apply=True,export_cameras=False,export_lights=False)
    for root,location in saved:root.location=location
    for i in range(3):bpy.data.objects['JAW_'+str(i)].rotation_euler.z=.35
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'devorador-lowpoly.blend'))
    return {'glb':str(target),'blend':str(OUT/'devorador-lowpoly.blend'),'bytes':target.stat().st_size,'meshes':len([o for o in scene.objects if o.type=='MESH'])}

if __name__=='__main__':
    result=blockout()
    result=refine()

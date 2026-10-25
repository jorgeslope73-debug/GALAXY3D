"""Generate silhouettes from projected GLB triangles. Requires numpy and Pillow.
First: node tools/profile-geometry.mjs /tmp/galaxy-geometry.json
Then: python tools/build-collision-profiles.py geometry.json profiles.json
Finally: node tools/pack-collision-profiles.mjs profiles.json
No images, textures or personal metadata are included in the output.
"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw

def distance(p,a,b):
    vx=b[0]-a[0]; vy=b[1]-a[1]
    t=max(0,min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/(vx*vx+vy*vy or 1)))
    return math.hypot(p[0]-a[0]-vx*t,p[1]-a[1]-vy*t)

def rdp(points,tol):
    if len(points)<=2:return points
    ds=[distance(p,points[0],points[-1]) for p in points];i=max(range(len(ds)),key=ds.__getitem__)
    if ds[i]<=tol:return [points[0],points[-1]]
    return rdp(points[:i+1],tol)[:-1]+rdp(points[i:],tol)

def outline(xy,tri,scale):
    n=1152;offset=n//2
    mask=Image.new('1',(n,n));draw=ImageDraw.Draw(mask)
    for face in tri:draw.polygon([tuple(p*scale+offset) for p in xy[face]],fill=1)
    a=np.asarray(mask);edges={}
    # Only boundary pixels; avoid Python loops over the complete interior.
    for test,side in [(a&~np.roll(a,1,axis=0),0),(a&~np.roll(a,-1,axis=1),1),(a&~np.roll(a,-1,axis=0),2),(a&~np.roll(a,1,axis=1),3)]:
        ys,xs=np.nonzero(test)
        for x,y in zip(xs.tolist(),ys.tolist()):
            start,end=[((x,y),(x+1,y)),((x+1,y),(x+1,y+1)),((x+1,y+1),(x,y+1)),((x,y+1),(x,y))][side]
            edges.setdefault(start,[]).append(end)
    loops=[]
    while edges:
        start=next(iter(edges));loop=[start];cur=start
        while True:
            options=edges.get(cur)
            if not options:break
            nxt=options.pop()
            if not options:del edges[cur]
            if nxt==start:break
            loop.append(nxt);cur=nxt
        if len(loop)>10:loops.append(loop)
    loop=max(loops,key=len);i=max(range(len(loop)),key=lambda i:math.dist(loop[0],loop[i]))
    poly=rdp(loop[:i+1],1.6)[:-1]+rdp(loop[i:]+[loop[0]],1.6)[:-1]
    return [[round((x-offset)/scale,5),round((y-offset)/scale,5)] for x,y in poly]

data=json.load(open(sys.argv[1],encoding='utf8'));out={};axis=np.array([.61,.73,.31]);axis/=np.linalg.norm(axis)
for kind,count in [('ship',121),('medium',720)]:
    v=np.array(data[kind]['vertices']);tri=np.array(data[kind]['triangles']);profiles=[]
    for i in range(count):
        if kind=='ship':
            a=math.radians(i-60);c=math.cos(a);s=math.sin(a)
            projected=np.column_stack((v[:,0]*c+v[:,2]*s,-v[:,1]));scale=10
        else:
            a=i*2*math.pi/count;c=math.cos(a);s=math.sin(a)
            rotated=v*c+np.cross(axis,v)*s+np.outer(v@axis,axis)*(1-c)
            projected=rotated[:,:2]*[1,-1];scale=512
        profiles.append(outline(projected,tri,scale))
        if i%60==0:print(kind,i,'/',count,flush=True)
    out[kind]=profiles
with open(sys.argv[2],'w',encoding='utf8') as f:json.dump(out,f,separators=(',',':'))
print('complete',flush=True)

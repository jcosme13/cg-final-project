"use strict";

var canvas;
var gl;

var program;

const at = [0, 6, 0];
const eye = [0, 0, -10];
const up = [0, 1, 0];

var lightPosition = vec4(1.0, 2.0, 5.0, 1.0); 
var lightAmbient = vec4(0.3, 0.3, 0.3, 1.0);
var lightDiffuse = vec4(1.0, 1.0, 1.0, 1.0);
var lightSpecular = vec4(1.0, 1.0, 1.0, 1.0);

// must specify reflectivity coefficients
var materialAmbient = vec4(1.0, 0.0, 1.0, 1.0);
var materialDiffuse = vec4(1.0, 0.8, 0.0, 1.0);
var materialSpecular = vec4(1.0, 0.8, 0.0, 1.0);
var materialShininess = 100.0; // must specify shininess for specular component

var ambient;
var diffuse;
var specular;

var near = 0.1;
var far = 50;

var fovy = 60.0 * Math.PI / 180;        // Field-of-view in Y direction angle 
var aspect = 1.0;       // Viewport aspect ratio

var response;
var data;
var text;
var bufferInfo;
var meshProgramInfo

// OBJ parser from https://webglfundamentals.org/webgl/lessons/webgl-load-obj.html

function parseOBJ(text) {
  // because indices are base 1 let's just fill in the 0th data
  const objPositions = [[0, 0, 0]];
  const objTexcoords = [[0, 0]];
  const objNormals = [[0, 0, 0]];

  // same order as `f` indices
  const objVertexData = [
    objPositions,
    objTexcoords,
    objNormals,
  ];

  // same order as `f` indices
  let webglVertexData = [
    [],   // positions
    [],   // texcoords
    [],   // normals
  ];

  function newGeometry() {
    // If there is an existing geometry and it's
    // not empty then start a new one.
    if (geometry && geometry.data.position.length) {
      geometry = undefined;
    }
    setGeometry();
  }

  function addVertex(vert) {
    const ptn = vert.split('/');
    ptn.forEach((objIndexStr, i) => {
      if (!objIndexStr) {
        return;
      }
      const objIndex = parseInt(objIndexStr);
      const index = objIndex + (objIndex >= 0 ? 0 : objVertexData[i].length);
      webglVertexData[i].push(...objVertexData[i][index]);
    });
  }

  const keywords = {
    v(parts) {
      objPositions.push(parts.map(parseFloat));
    },
    vn(parts) {
      objNormals.push(parts.map(parseFloat));
    },
    vt(parts) {
      // should check for missing v and extra w?
      objTexcoords.push(parts.map(parseFloat));
    },
    f(parts) {
      const numTriangles = parts.length - 2;
      for (let tri = 0; tri < numTriangles; ++tri) {
        addVertex(parts[0]);
        addVertex(parts[tri + 1]);
        addVertex(parts[tri + 2]);
      }
    },
  };

  const keywordRE = /(\w*)(?: )*(.*)/;
  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
    const line = lines[lineNo].trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const m = keywordRE.exec(line);
    if (!m) {
      continue;
    }
    const [, keyword, unparsedArgs] = m;
    const parts = line.split(/\s+/).slice(1);
    const handler = keywords[keyword];
    if (!handler) {
      //console.warn('unhandled keyword:', keyword);  // eslint-disable-line no-console
      continue;
    }
    handler(parts, unparsedArgs);
  }

  return {
    position: webglVertexData[0],
    texcoord: webglVertexData[1],
    normal: webglVertexData[2],
  };
}

window.onload = async function init() {

  canvas = document.getElementById("gl-canvas")

  gl = WebGLUtils.setupWebGL(canvas)
  if (!gl) {
    alert("WebGL isn't available");
  }

  gl.clearColor(0.5, 1.0, 0.0, 0.0);

  webglUtils.resizeCanvasToDisplaySize(gl.canvas);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);

  response = await fetch('treeFolder/treeTest.obj');  
  text = await response.text();
  data = parseOBJ(text);

  bufferInfo = webglUtils.createBufferInfoFromArrays(gl, data);
  
  const vertexShader = `
  attribute vec4 a_position;
  attribute vec3 a_normal;

  uniform mat4 projectionMatrix;
  uniform mat4 modelViewMatrix;
  uniform mat4 u_world;

  uniform vec4 ambientProduct, diffuseProduct, specularProduct;
  uniform vec4 lightPosition;
  uniform float shininess;

  varying vec3 v_normal;
  varying vec4 fColor;

  void main() {
        vec3 pos = -(modelViewMatrix*a_position).xyz;

        // fixed light position

        vec3 light = lightPosition.xyz;
        vec3 L = normalize( light - pos );

        vec3 E = normalize( -pos );
        vec3 H = normalize( L + E );

        vec4 NN = vec4( a_normal, 0 );

        // Transform vertex normal into eye coordinates

        vec3 N = normalize( (modelViewMatrix*NN).xyz);

        // Compute terms in the illumination equation
        vec4 ambient = ambientProduct;

        float Kd = max( dot(L,N), 0.0 );
        vec4 diffuse = Kd * diffuseProduct;

        float Ks = pow (max(dot(N, H), 0.0), shininess );
        vec4 specular = Ks * specularProduct;

        if  (dot(L, N) < 0.0 ){
            specular = vec4(0.0, 0.0, 0.0, 1.0);
        }

    gl_Position = projectionMatrix * modelViewMatrix * u_world * a_position;
    fColor = ambient + diffuse + specular;
    v_normal = mat3(u_world) * a_normal;

    fColor.a = 1.0;
  }
  `;

  const fragmentShader = `
  precision mediump float;

  varying vec3 v_normal;

  uniform vec4 u_diffuse;
  uniform vec3 u_lightDirection;
  varying vec4 fColor;

  void main () {
    vec3 normal = normalize(v_normal);
    float fakeLight = dot(u_lightDirection, normal) * .5 + .5;
    gl_FragColor = vec4(fColor.rgb * fakeLight, u_diffuse.a);
    //gl_FragColor = fColor;
  }
  `;

  document.getElementById("x-button").onchange = function(event) {
    lightPosition[0] = event.target.value;
  };
  document.getElementById("y-button").onchange = function(event) {
    lightPosition[1] = event.target.value;
  };

  // compiles and links the shaders, looks up attribute and uniform locations
  meshProgramInfo = webglUtils.createProgramInfo(gl, [vertexShader, fragmentShader]);

  requestAnimationFrame(render);
}

  function render(time) {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    time *= 0.0005;

    var projection = m4.perspective(fovy, aspect, near, far);

    var camera = flatten(m4.lookAt(eye, at, up));

    var view = flatten(m4.inverse(camera));

    ambient = flatten(mult(lightAmbient, materialAmbient));
    diffuse = flatten(mult(lightDiffuse, materialDiffuse));
    specular = flatten(mult(lightSpecular, materialSpecular));

    const sharedUniforms = {
      u_lightDirection: m4.normalize(lightPosition),
      modelViewMatrix: view,
      projectionMatrix: projection,
    };

    gl.useProgram(meshProgramInfo.program);

    // calls gl.uniform
    webglUtils.setUniforms(meshProgramInfo, sharedUniforms);

    // calls gl.bindBuffer, gl.enableVertexAttribArray, gl.vertexAttribPointer
    webglUtils.setBuffersAndAttributes(gl, meshProgramInfo, bufferInfo);

    // calls gl.uniform
    webglUtils.setUniforms(meshProgramInfo, {
      u_world: m4.yRotation(time),
      u_diffuse: [1, 0.7, 0.5, 1],
    });

    webglUtils.setUniforms(meshProgramInfo, {
      lightPosition: lightPosition,
      ambientProduct: ambient,
      diffuseProduct: diffuse,
      specularProduct: specular,
      shininess: materialShininess,
    });

    // calls gl.drawArrays
    webglUtils.drawBufferInfo(gl, bufferInfo);

    requestAnimationFrame(render);
  }
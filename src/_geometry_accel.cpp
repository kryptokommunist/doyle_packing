#define PY_SSIZE_T_CLEAN
#include <Python.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

struct IntersectionPoint {
    double t;
    double x;
    double y;
};

constexpr double kDegToRad = 0.017453292519943295769236907684886;

int ensure_double_2d(PyObject *obj, Py_buffer *view, const char *name) {
    if (PyObject_GetBuffer(obj, view, PyBUF_ND | PyBUF_C_CONTIGUOUS | PyBUF_FORMAT) != 0) {
        return 0;
    }
    if (view->ndim != 2) {
        PyErr_Format(PyExc_ValueError, "%s must be a 2D array", name);
        PyBuffer_Release(view);
        return 0;
    }
    if (view->shape[1] != 2) {
        PyErr_Format(PyExc_ValueError, "%s must have shape (N, 2)", name);
        PyBuffer_Release(view);
        return 0;
    }
    if (view->format == nullptr || std::strcmp(view->format, "d") != 0) {
        PyErr_Format(PyExc_TypeError, "%s must have dtype float64", name);
        PyBuffer_Release(view);
        return 0;
    }
    return 1;
}

Py_ssize_t effective_polygon_length(const double *poly, Py_ssize_t rows) {
    Py_ssize_t length = rows;
    if (length > 1) {
        const double *first = poly;
        const double *last = poly + (rows - 1) * 2;
        if (std::fabs(first[0] - last[0]) < 1e-9 && std::fabs(first[1] - last[1]) < 1e-9) {
            length -= 1;
        }
    }
    return length;
}

int point_in_polygon(double x, double y, const double *poly, Py_ssize_t n) {
    if (n < 3) {
        return 0;
    }
    int inside = 0;
    for (Py_ssize_t i = 0, j = n - 1; i < n; j = i++) {
        double xi = poly[i * 2];
        double yi = poly[i * 2 + 1];
        double xj = poly[j * 2];
        double yj = poly[j * 2 + 1];

        bool intersect = ((yi > y) != (yj > y)) &&
                         (x < (xj - xi) * (y - yi) / (yj - yi + 1e-300) + xi);
        if (intersect) {
            inside = !inside;
        }
    }
    return inside;
}

int compute_line_segment_intersection(
    const double *p1,
    const double *p2,
    const double *p3,
    const double *p4,
    double eps,
    IntersectionPoint *result
) {
    double x1 = p1[0], y1 = p1[1];
    double x2 = p2[0], y2 = p2[1];
    double x3 = p3[0], y3 = p3[1];
    double x4 = p4[0], y4 = p4[1];

    double denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (std::fabs(denom) < eps) {
        return 0;
    }

    double t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    double u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    if (t < -eps || t > 1.0 + eps || u < -eps || u > 1.0 + eps) {
        return 0;
    }

    result->t = t;
    result->x = x1 + t * (x2 - x1);
    result->y = y1 + t * (y2 - y1);
    return 1;
}

int parse_point_like(PyObject *obj, double *x, double *y, const char *name) {
    PyObject *seq = PySequence_Fast(obj, nullptr);
    if (seq == nullptr) {
        if (!PyErr_Occurred()) {
            PyErr_Format(PyExc_TypeError, "%s must be a sequence", name);
        }
        return 0;
    }

    Py_ssize_t length = PySequence_Fast_GET_SIZE(seq);
    if (length != 2) {
        Py_DECREF(seq);
        PyErr_Format(PyExc_ValueError, "%s must have length 2", name);
        return 0;
    }

    PyObject *item0 = PySequence_Fast_GET_ITEM(seq, 0);
    PyObject *item1 = PySequence_Fast_GET_ITEM(seq, 1);
    *x = PyFloat_AsDouble(item0);
    if (PyErr_Occurred()) {
        Py_DECREF(seq);
        return 0;
    }
    *y = PyFloat_AsDouble(item1);
    Py_DECREF(seq);
    if (PyErr_Occurred()) {
        return 0;
    }
    return 1;
}

}  // namespace

static PyObject *clip_lines_to_polygon(PyObject *self, PyObject *args) {
    PyObject *polygon_obj = nullptr;
    PyObject *line_starts_obj = nullptr;
    PyObject *line_ends_obj = nullptr;
    double eps = 1e-10;

    if (!PyArg_ParseTuple(args, "OOO|d", &polygon_obj, &line_starts_obj, &line_ends_obj, &eps)) {
        return nullptr;
    }

    Py_buffer poly_view;
    Py_buffer start_view;
    Py_buffer end_view;

    if (!ensure_double_2d(polygon_obj, &poly_view, "polygon")) {
        return nullptr;
    }
    if (!ensure_double_2d(line_starts_obj, &start_view, "line_starts")) {
        PyBuffer_Release(&poly_view);
        return nullptr;
    }
    if (!ensure_double_2d(line_ends_obj, &end_view, "line_ends")) {
        PyBuffer_Release(&poly_view);
        PyBuffer_Release(&start_view);
        return nullptr;
    }

    if (start_view.shape[0] != end_view.shape[0]) {
        PyErr_SetString(PyExc_ValueError, "line_starts and line_ends must have the same length");
        PyBuffer_Release(&poly_view);
        PyBuffer_Release(&start_view);
        PyBuffer_Release(&end_view);
        return nullptr;
    }

    const double *polygon = static_cast<const double *>(poly_view.buf);
    const double *line_starts = static_cast<const double *>(start_view.buf);
    const double *line_ends = static_cast<const double *>(end_view.buf);

    Py_ssize_t polygon_len = effective_polygon_length(polygon, poly_view.shape[0]);
    Py_ssize_t num_lines = start_view.shape[0];

    if (polygon_len < 3 || num_lines <= 0) {
        PyBuffer_Release(&poly_view);
        PyBuffer_Release(&start_view);
        PyBuffer_Release(&end_view);
        return PyList_New(0);
    }

    PyObject *result = PyList_New(0);
    if (result == nullptr) {
        PyBuffer_Release(&poly_view);
        PyBuffer_Release(&start_view);
        PyBuffer_Release(&end_view);
        return nullptr;
    }

    IntersectionPoint *intersections = static_cast<IntersectionPoint *>(
        PyMem_Malloc(sizeof(IntersectionPoint) * static_cast<size_t>(polygon_len)));
    if (intersections == nullptr) {
        PyErr_NoMemory();
        Py_DECREF(result);
        PyBuffer_Release(&poly_view);
        PyBuffer_Release(&start_view);
        PyBuffer_Release(&end_view);
        return nullptr;
    }

    for (Py_ssize_t i = 0; i < num_lines; ++i) {
        const double *start = line_starts + i * 2;
        const double *end = line_ends + i * 2;
        Py_ssize_t count = 0;

        for (Py_ssize_t j = 0; j < polygon_len; ++j) {
            const double *p3 = polygon + j * 2;
            const double *p4 = polygon + ((j + 1) % polygon_len) * 2;
            IntersectionPoint ip;
            if (compute_line_segment_intersection(start, end, p3, p4, eps, &ip)) {
                intersections[count++] = ip;
            }
        }

        if (count < 2) {
            continue;
        }

        std::sort(intersections, intersections + count, [](const IntersectionPoint &a, const IntersectionPoint &b) {
            return a.t < b.t;
        });

        Py_ssize_t unique_count = 0;
        for (Py_ssize_t j = 0; j < count; ++j) {
            if (unique_count > 0 && std::fabs(intersections[j].t - intersections[unique_count - 1].t) < 1e-9) {
                continue;
            }
            intersections[unique_count++] = intersections[j];
        }

        for (Py_ssize_t j = 0; j + 1 < unique_count; j += 2) {
            double x1 = intersections[j].x;
            double y1 = intersections[j].y;
            double x2 = intersections[j + 1].x;
            double y2 = intersections[j + 1].y;
            double mid_x = 0.5 * (x1 + x2);
            double mid_y = 0.5 * (y1 + y2);

            if (!point_in_polygon(mid_x, mid_y, polygon, polygon_len)) {
                continue;
            }

            PyObject *segment = PyTuple_New(2);
            if (segment == nullptr) {
                Py_DECREF(result);
                PyMem_Free(intersections);
                PyBuffer_Release(&poly_view);
                PyBuffer_Release(&start_view);
                PyBuffer_Release(&end_view);
                return nullptr;
            }

            PyObject *start_tuple = Py_BuildValue("(dd)", x1, y1);
            PyObject *end_tuple = Py_BuildValue("(dd)", x2, y2);
            if (start_tuple == nullptr || end_tuple == nullptr) {
                Py_XDECREF(start_tuple);
                Py_XDECREF(end_tuple);
                Py_DECREF(segment);
                Py_DECREF(result);
                PyMem_Free(intersections);
                PyBuffer_Release(&poly_view);
                PyBuffer_Release(&start_view);
                PyBuffer_Release(&end_view);
                return nullptr;
            }

            PyTuple_SET_ITEM(segment, 0, start_tuple);
            PyTuple_SET_ITEM(segment, 1, end_tuple);

            if (PyList_Append(result, segment) != 0) {
                Py_DECREF(segment);
                Py_DECREF(result);
                PyMem_Free(intersections);
                PyBuffer_Release(&poly_view);
                PyBuffer_Release(&start_view);
                PyBuffer_Release(&end_view);
                return nullptr;
            }
            Py_DECREF(segment);
        }
    }

    PyMem_Free(intersections);
    PyBuffer_Release(&poly_view);
    PyBuffer_Release(&start_view);
    PyBuffer_Release(&end_view);
    return result;
}

static PyObject *generate_line_fill(PyObject *self, PyObject *args, PyObject *kwargs) {
    PyObject *polygon_obj = nullptr;
    double spacing = 0.0;
    double angle_deg = 0.0;
    PyObject *centroid_obj = Py_None;
    PyObject *bbox_obj = Py_None;
    double overshoot = 2.0;
    static const char *kwlist[] = {"polygon", "spacing", "angle", "centroid", "bbox_diag", "overshoot", nullptr};

    if (!PyArg_ParseTupleAndKeywords(
            args,
            kwargs,
            "Odd|OOd",
            const_cast<char **>(kwlist),
            &polygon_obj,
            &spacing,
            &angle_deg,
            &centroid_obj,
            &bbox_obj,
            &overshoot)) {
        return nullptr;
    }

    if (spacing <= 0.0) {
        PyErr_SetString(PyExc_ValueError, "spacing must be positive");
        return nullptr;
    }

    if (overshoot <= 0.0) {
        overshoot = 2.0;
    }

    Py_buffer poly_view;
    if (!ensure_double_2d(polygon_obj, &poly_view, "polygon")) {
        return nullptr;
    }

    const double *polygon = static_cast<const double *>(poly_view.buf);
    Py_ssize_t polygon_len = effective_polygon_length(polygon, poly_view.shape[0]);

    if (polygon_len < 3) {
        PyBuffer_Release(&poly_view);
        return PyList_New(0);
    }

    double centroid_x = 0.0;
    double centroid_y = 0.0;
    if (centroid_obj != Py_None) {
        if (!parse_point_like(centroid_obj, &centroid_x, &centroid_y, "centroid")) {
            PyBuffer_Release(&poly_view);
            return nullptr;
        }
    } else {
        for (Py_ssize_t i = 0; i < polygon_len; ++i) {
            centroid_x += polygon[i * 2];
            centroid_y += polygon[i * 2 + 1];
        }
        centroid_x /= static_cast<double>(polygon_len);
        centroid_y /= static_cast<double>(polygon_len);
    }

    double bbox_diag = 0.0;
    if (bbox_obj != Py_None) {
        bbox_diag = PyFloat_AsDouble(bbox_obj);
        if (PyErr_Occurred()) {
            PyBuffer_Release(&poly_view);
            return nullptr;
        }
    }

    if (bbox_diag <= 0.0) {
        double min_x = polygon[0];
        double max_x = polygon[0];
        double min_y = polygon[1];
        double max_y = polygon[1];
        for (Py_ssize_t i = 1; i < polygon_len; ++i) {
            double x = polygon[i * 2];
            double y = polygon[i * 2 + 1];
            if (x < min_x) {
                min_x = x;
            }
            if (x > max_x) {
                max_x = x;
            }
            if (y < min_y) {
                min_y = y;
            }
            if (y > max_y) {
                max_y = y;
            }
        }
        bbox_diag = std::hypot(max_x - min_x, max_y - min_y);
    }

    if (bbox_diag <= 0.0) {
        PyBuffer_Release(&poly_view);
        return PyList_New(0);
    }

    double radians = angle_deg * kDegToRad;
    double line_dir_x = std::cos(radians);
    double line_dir_y = std::sin(radians);
    double perp_x = -line_dir_y;
    double perp_y = line_dir_x;

    double safe_spacing = spacing < 1e-6 ? 1e-6 : spacing;
    Py_ssize_t num_lines = static_cast<Py_ssize_t>(bbox_diag / safe_spacing) + 3;

    double span_scale = bbox_diag * overshoot;
    double span_x = line_dir_x * span_scale;
    double span_y = line_dir_y * span_scale;
    double start_base_x = centroid_x - span_x;
    double start_base_y = centroid_y - span_y;
    double end_base_x = centroid_x + span_x;
    double end_base_y = centroid_y + span_y;

    std::vector<double> segments;
    segments.reserve(static_cast<std::size_t>(num_lines) * 4U);

    std::vector<IntersectionPoint> intersections;
    intersections.reserve(static_cast<std::size_t>(polygon_len));
    std::vector<IntersectionPoint> unique_intersections;
    unique_intersections.reserve(static_cast<std::size_t>(polygon_len));

    const double eps = 1e-10;

    for (Py_ssize_t idx = -num_lines; idx <= num_lines; ++idx) {
        double offset = static_cast<double>(idx) * spacing;
        double start[2] = {
            start_base_x + offset * perp_x,
            start_base_y + offset * perp_y,
        };
        double end[2] = {
            end_base_x + offset * perp_x,
            end_base_y + offset * perp_y,
        };

        intersections.clear();
        for (Py_ssize_t j = 0; j < polygon_len; ++j) {
            const double *p3 = polygon + j * 2;
            const double *p4 = polygon + ((j + 1) % polygon_len) * 2;
            IntersectionPoint ip;
            if (compute_line_segment_intersection(start, end, p3, p4, eps, &ip)) {
                intersections.push_back(ip);
            }
        }

        if (intersections.size() < 2) {
            continue;
        }

        std::sort(intersections.begin(), intersections.end(), [](const IntersectionPoint &a, const IntersectionPoint &b) {
            return a.t < b.t;
        });

        unique_intersections.clear();
        for (const auto &ip : intersections) {
            if (!unique_intersections.empty() && std::fabs(ip.t - unique_intersections.back().t) < 1e-9) {
                continue;
            }
            unique_intersections.push_back(ip);
        }

        for (std::size_t k = 0; k + 1 < unique_intersections.size(); k += 2) {
            double x1 = unique_intersections[k].x;
            double y1 = unique_intersections[k].y;
            double x2 = unique_intersections[k + 1].x;
            double y2 = unique_intersections[k + 1].y;

            double mid_x = 0.5 * (x1 + x2);
            double mid_y = 0.5 * (y1 + y2);
            if (!point_in_polygon(mid_x, mid_y, polygon, polygon_len)) {
                continue;
            }

            segments.push_back(x1);
            segments.push_back(y1);
            segments.push_back(x2);
            segments.push_back(y2);
        }
    }

    Py_ssize_t segment_count = static_cast<Py_ssize_t>(segments.size() / 4);
    PyObject *result = PyList_New(segment_count);
    if (result == nullptr) {
        PyBuffer_Release(&poly_view);
        return nullptr;
    }

    for (Py_ssize_t i = 0; i < segment_count; ++i) {
        double x1 = segments[i * 4];
        double y1 = segments[i * 4 + 1];
        double x2 = segments[i * 4 + 2];
        double y2 = segments[i * 4 + 3];

        PyObject *segment = PyTuple_New(2);
        if (segment == nullptr) {
            Py_DECREF(result);
            PyBuffer_Release(&poly_view);
            return nullptr;
        }

        PyObject *start_tuple = Py_BuildValue("(dd)", x1, y1);
        PyObject *end_tuple = Py_BuildValue("(dd)", x2, y2);
        if (start_tuple == nullptr || end_tuple == nullptr) {
            Py_XDECREF(start_tuple);
            Py_XDECREF(end_tuple);
            Py_DECREF(segment);
            Py_DECREF(result);
            PyBuffer_Release(&poly_view);
            return nullptr;
        }

        PyTuple_SET_ITEM(segment, 0, start_tuple);
        PyTuple_SET_ITEM(segment, 1, end_tuple);
        PyList_SET_ITEM(result, i, segment);
    }

    PyBuffer_Release(&poly_view);
    return result;
}

static PyObject *circle_circle_intersections(PyObject *self, PyObject *args) {
    double cx1, cy1, r1, cx2, cy2, r2, tol;
    if (!PyArg_ParseTuple(args, "ddddddd", &cx1, &cy1, &r1, &cx2, &cy2, &r2, &tol)) {
        return nullptr;
    }

    double dx = cx2 - cx1;
    double dy = cy2 - cy1;
    double d = std::hypot(dx, dy);
    double sum_r = r1 + r2;
    double diff_r = std::fabs(r1 - r2);

    PyObject *result = PyList_New(0);
    if (result == nullptr) {
        return nullptr;
    }

    if (d > sum_r + tol || d < diff_r - tol || d < tol) {
        return result;
    }

    double a = (r1 * r1 - r2 * r2 + d * d) / (2.0 * d);
    double h_sq = r1 * r1 - a * a;

    if (h_sq < -tol) {
        return result;
    }

    double h = 0.0;
    if (h_sq > 0.0) {
        h = std::sqrt(std::fmax(h_sq, 0.0));
    }

    double mid_x = cx1 + a * dx / d;
    double mid_y = cy1 + a * dy / d;
    double rx = -dy / d;
    double ry = dx / d;

    double p1x = mid_x + h * rx;
    double p1y = mid_y + h * ry;
    PyObject *p1 = PyComplex_FromDoubles(p1x, p1y);
    if (p1 == nullptr) {
        Py_DECREF(result);
        return nullptr;
    }
    if (PyList_Append(result, p1) != 0) {
        Py_DECREF(p1);
        Py_DECREF(result);
        return nullptr;
    }
    Py_DECREF(p1);

    if (h > tol) {
        double p2x = mid_x - h * rx;
        double p2y = mid_y - h * ry;
        PyObject *p2 = PyComplex_FromDoubles(p2x, p2y);
        if (p2 == nullptr) {
            Py_DECREF(result);
            return nullptr;
        }
        if (PyList_Append(result, p2) != 0) {
            Py_DECREF(p2);
            Py_DECREF(result);
            return nullptr;
        }
        Py_DECREF(p2);
    }

    return result;
}

static PyMethodDef GeometryAccelMethods[] = {
    {"clip_lines_to_polygon", clip_lines_to_polygon, METH_VARARGS, "Clip parallel lines to a polygon and return segments."},
    {"generate_line_fill", (PyCFunction)generate_line_fill, METH_VARARGS | METH_KEYWORDS, "Generate clipped parallel line segments for a polygon."},
    {"circle_circle_intersections", circle_circle_intersections, METH_VARARGS, "Compute intersection points of two circles."},
    {nullptr, nullptr, 0, nullptr},
};

static struct PyModuleDef geometryaccelmodule = {
    PyModuleDef_HEAD_INIT,
    "_geometry_accel",
    "Accelerated geometry helpers for Doyle spiral rendering.",
    -1,
    GeometryAccelMethods
};

extern "C" PyMODINIT_FUNC PyInit__geometry_accel(void) {
    return PyModule_Create(&geometryaccelmodule);
}
